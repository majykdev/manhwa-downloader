"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");
const config = require("../config");
const asura = require("../scraper/asura");
const atsu = require("../scraper/atsu");
const generic = require("../scraper/generic");
const { PdfBuilder } = require("../pdf/builder");
const {
  SpeedController,
  DynamicLimiter,
  isRateLimitError,
} = require("./speedController");
const {
  debugLog,
  debugChapterDownloaded,
  debugScrapeComplete,
} = require("../debug");
const { removeJobArtifacts } = require("./store");
const { sleep, mapLimit, sanitizeFilename } = require("../util");

const BASE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "asura-dl-"));

async function runJob(store, job, { retry = false } = {}) {
  job.status = "running";
  job.error = null;
  job.finishedAt = null;
  const dir = job.tmpDir || fs.mkdtempSync(path.join(BASE_TMP, `${job.id}-`));
  job.tmpDir = dir;
  let pdfPath = null;
  const speed = new SpeedController(job.settings || {});
  job.speed = speed.snapshot();
  const limiter = new DynamicLimiter(speed.concurrency());

  const handleFailure = (err) => {
    if (!isRateLimitError(err)) return;
    speed.reportRateLimit((line) => store.pushLog(job, line));
    limiter.setMax(speed.concurrency());
    job.speed = speed.snapshot();
  };

  try {
    if (!retry) {
      store.setPhase(job, "discovering");
      if (job.kind === "generic" || job.kind === "atsu") {
        job.totalChapters = (job.chapterUrls || []).length;
        for (let i = 0; i < job.totalChapters; i++) {
          const meta = (job.chapterMeta || [])[i] || {};
          store.setChapter(job, i, {
            status: "pending",
            label: meta.label ?? meta.number ?? chapterLabel(job, i),
            detail: meta.detail || null,
            parts: meta.parts || null,
            provider: meta.provider || null,
          });
        }
        store.pushLog(job, `Found ${job.totalChapters} chapters.`);
      } else {
        const start = job.startChapter ?? job.firstChapter ?? null;
        const info = await asura.discoverRange(job.slug, start, (m) =>
          store.pushLog(job, m),
          job.endChapter ?? null,
        );
        job.title = info.title;
        job.coverUrl = info.coverUrl || job.coverUrl || null;
        job.firstChapter = info.firstChapter;
        job.lastChapter = info.lastChapter;
        job.totalChapters = info.lastChapter - info.firstChapter + 1;
        for (let ch = info.firstChapter; ch <= info.lastChapter; ch++) {
          store.setChapter(job, ch, { status: "pending", label: ch });
        }
        store.pushLog(
          job,
          `Found ${job.totalChapters} chapters (${info.firstChapter}–${info.lastChapter}).`,
        );
      }
    }

    pdfPath = path.join(dir, `${sanitizeFilename(job.title || job.slug || "comic")}.pdf`);
    job.pdfPath = pdfPath;

    await prepareCover(store, job, dir);

    store.setPhase(job, "scraping");
    await fetchPrologue(store, job, dir, speed.delayMs());

    const todo = retry
      ? store.findRetryable(job).filter((key) => !isPrologue(job, key))
      : regularChapterKeys(job);
    await Promise.all(
      todo.map((key) =>
        limiter.run(async () => {
          await store.waitForResume(job);
          if (speed.delayMs() > 0) await sleep(speed.delayMs());
          await processChapter(store, job, key, speed, handleFailure);
        }),
      ),
    );

    store.setPhase(job, "assembling");
    await buildPdf(store, job, pdfPath);
    recount(job);
    store.setPhase(job, "done");
    store.finish(job, "complete", { pdfPath });
    store.pushLog(
      job,
      `Done — ${job.pages} pages across ${job.totalChapters} chapters.`,
    );
    debugScrapeComplete(
      job.id,
      job.title || job.slug || "comic",
      job.pages,
      job.totalChapters,
    );
  } catch (err) {
    debugLog("error", `Job ${job.id} fatal: ${err.stack || err.message}`);
    store.pushLog(job, `Fatal: ${err.message}`);
    removeJobArtifacts(job);
    store.setPhase(job, "failed");
    store.finish(job, "failed", { error: err.message });
  }
}

async function processChapter(store, job, key, speed, handleFailure) {
  store.setChapter(job, key, { status: "scraping", pagesDone: 0, pagesTotal: 0, reason: null });
  job.currentChapter = key;

  const data = job.chapters[key] || {};
  const label = data.label ?? key;
  let chap;
  try {
    chap = await fetchChap(job, key);
  } catch (err) {
    handleFailure(err);
    const reason = `load failed (${err.status || err.code || "error"})`;
    store.pushLog(job, `${label}: failed to load (${err.status || err.code || "error"}) — skipped.`);
    store.setChapter(job, key, { status: "skipped", reason });
    job.skipped += 1;
    return;
  }

  if (chap.notFound) {
    store.pushLog(job, `${label}: not found — skipped.`);
    store.setChapter(job, key, { status: "skipped", reason: "not found" });
    job.skipped += 1;
    return;
  }
  if (chap.locked) {
    store.pushLog(job, `${label}: locked/premium — skipped.`);
    store.setChapter(job, key, { status: "skipped", reason: "locked/premium" });
    job.locked += 1;
    job.skipped += 1;
    return;
  }
  if (chap.blocked) {
    store.pushLog(job, `${label}: blocked by captcha — skipped.`);
    store.setChapter(job, key, { status: "skipped", reason: "blocked by captcha" });
    job.skipped += 1;
    return;
  }
  if (chap.images.length === 0) {
    store.pushLog(job, `${label}: no pages found — skipped.`);
    store.setChapter(job, key, { status: "skipped", reason: "no pages found" });
    job.skipped += 1;
    return;
  }

  const images = chap.images.slice(0, config.MAX_IMAGES_PER_CHAPTER);
  store.setChapter(job, key, { pagesTotal: images.length });
  try {
    const prepared = await downloadImages(store, job, key, images, label);
    await saveChapter(job.tmpDir, key, prepared);
    store.setChapter(job, key, { status: "done", pagesDone: prepared.length });
    job.pages += prepared.length;
    store.pushLog(job, `${label}: ${prepared.length} pages`);
    debugChapterDownloaded(job.id, label, prepared.length, data.provider);
    speed.reportSuccess();
    job.speed = speed.snapshot();
  } catch (err) {
    handleFailure(err);
    const reason = `image download failed (${err.status || err.code || "error"})`;
    store.pushLog(job, `${label}: ${reason} — chapter skipped.`);
    store.setChapter(job, key, { status: "skipped", reason });
    job.skipped += 1;
  }
}

async function buildPdf(store, job, pdfPath, { partial = false, doneOnly = false } = {}) {
  const builder = new PdfBuilder(pdfPath);
  let keys = regularChapterKeys(job);
  if (doneOnly) {
    keys = keys.filter(
      (key) =>
        job.chapters[key]?.status === "done" && chapterInfo(job.tmpDir, key).files.length > 0,
    );
  }
  const contents = [];
  let imagePages = 0;

  const includePrologue =
    job.hasPrologue ||
    (!doneOnly
      ? false
      : job.chapters[0]?.status === "done" && chapterInfo(job.tmpDir, 0).files.length > 0);

  const addChapter = async (key, label, detail) => {
    const info = chapterInfo(job.tmpDir, key);
    const pageSize = info.dimensions.length
      ? builder.pageSizeFromDimensions(info.dimensions[0])
      : null;
    const pageIndex = builder.addSpacer(label, pageSize, detail);
    contents.push({
      label: detail ? `${label} — ${detail}` : label,
      pageIndex,
    });

    for (let i = 0; i < info.files.length; i++) {
      const buffer = fs.readFileSync(info.files[i]);
      if (info.prepared) {
        await builder.addPreparedImage(buffer, info.dimensions[i] || {}, pageSize);
      } else {
        await builder.addImage(buffer, pageSize);
      }
      imagePages += 1;
    }
  };

  if (includePrologue) await addChapter(0, "Prologue");

  for (const key of keys) {
    const data = job.chapters[key] || {};
    const label = data.label ?? chapterLabel(job, key);
    const detail = data.detail || null;
    await addChapter(key, `Chapter ${label}`, detail);
  }

  builder.addTitlePage(job.title || job.slug || "comic", contents);

  let coverPages = 0;
  const coverPath = path.join(job.tmpDir, "cover.img");
  if (fs.existsSync(coverPath)) {
    let dimensions = {};
    try {
      dimensions = JSON.parse(
        fs.readFileSync(path.join(job.tmpDir, "cover.meta.json"), "utf8"),
      );
    } catch {}
    await builder.addCover(fs.readFileSync(coverPath), dimensions);
    coverPages = 1;
  }

  await builder.finish();

  const totalPages = imagePages + coverPages;
  if (!partial) {
    job.currentPage = totalPages;
    job.pages = totalPages;
  }
  return { pages: totalPages, contents };
}

function fetchChap(job, key) {
  if (job.kind === "generic") {
    return generic.fetchChapter(job.chapterUrls[key]);
  }
  if (job.kind === "atsu") {
    const parts = job.chapterParts && job.chapterParts[key];
    if (Array.isArray(parts) && parts.length > 1) {
      return fetchCombinedAtsuChapter(parts);
    }
    return atsu.fetchChapter(job.chapterUrls[key]);
  }
  return asura.fetchChapter(job.slug, key);
}

async function fetchCombinedAtsuChapter(urls) {
  const images = [];
  let locked = false;
  let blocked = false;
  let notFound = false;
  let title = null;
  for (const url of urls) {
    const part = await atsu.fetchChapter(url);
    locked = locked || part.locked;
    blocked = blocked || part.blocked;
    notFound = notFound || part.notFound;
    title = title || part.title;
    images.push(...(part.images || []));
  }
  return { images, locked, blocked, notFound, title, rendered: false };
}

async function downloadImages(store, job, key, images, label) {
  return mapLimit(images, config.IMAGE_PARALLELISM, async (url) => {
    await store.waitForResume(job);
    let buffer;
    try {
      buffer = await asura.downloadImage(url, () =>
        store.pushLog(job, `${label}: retrying image…`),
      );
    } catch (err) {
      const viaBrowser = generic.fetchViaBrowser
        ? await generic.fetchViaBrowser(url, {
            referer: job.chapterUrls ? job.chapterUrls[key] : undefined,
          })
        : null;
      if (viaBrowser && viaBrowser.length > 0) {
        store.pushLog(job, `${label}: fetched image via browser fallback.`);
        buffer = viaBrowser;
      } else {
        throw err;
      }
    }
    return prepareImage(buffer);
  });
}

async function prepareCover(store, job, dir) {
  const coverPath = path.join(dir, "cover.img");
  const metaPath = path.join(dir, "cover.meta.json");
  if (fs.existsSync(coverPath)) {
    job.coverPath = coverPath;
    try {
      job.coverDimensions = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    } catch {
      job.coverDimensions = null;
    }
    return;
  }
  if (!job.coverUrl) return;

  let buffer;
  try {
    buffer = await asura.downloadImage(job.coverUrl, () =>
      store.pushLog(job, "Cover: retrying image…"),
    );
  } catch (err) {
    const viaBrowser = generic.fetchViaBrowser
      ? await generic.fetchViaBrowser(job.coverUrl, { referer: job.url })
      : null;
    if (!viaBrowser || viaBrowser.length === 0) {
      store.pushLog(
        job,
        `Cover: download failed (${err.status || err.code || "error"}) — continuing without cover.`,
      );
      return;
    }
    store.pushLog(job, "Cover: fetched via browser fallback.");
    buffer = viaBrowser;
  }

  try {
    const prepared = await prepareImage(buffer);
    const dimensions = { width: prepared.width, height: prepared.height };
    fs.writeFileSync(coverPath, prepared.buffer);
    fs.writeFileSync(metaPath, JSON.stringify(dimensions));
    job.coverPath = coverPath;
    job.coverDimensions = dimensions;
    store.pushLog(job, "Cover: added.");
  } catch (err) {
    store.pushLog(job, `Cover: prepare failed (${err.message}) — continuing without cover.`);
  }
}

async function prepareImage(buffer) {
  const image = sharp(buffer);
  const meta = await image.metadata();
  const width = Math.max(1, meta.width || config.PDF_MAX_PAGE_WIDTH);
  const height = Math.max(1, meta.height || 1);
  const targetWidth = Math.min(width, config.PDF_MAX_PAGE_WIDTH * 2);
  const jpeg = await image
    .clone()
    .resize({ width: targetWidth })
    .jpeg({ quality: config.PDF_JPEG_QUALITY })
    .toBuffer();
  return { buffer: jpeg, width, height };
}

async function fetchPrologue(store, job, dir, delayMs) {
  if (job.hasPrologue || (job.kind !== "asura" && job.kind !== "atsu")) return;
  if (job.kind === "atsu" && !job.prologueUrl) return;
  const start = job.startChapter ?? job.firstChapter;
  if (Number.isFinite(start) && Number(start) > 0) return;

  let chap;
  try {
    chap =
      job.kind === "atsu"
        ? await atsu.fetchChapter(job.prologueUrl)
        : await asura.fetchChapter(job.slug, 0);
  } catch (err) {
    store.pushLog(job, `Prologue: check failed (${err.status || err.code || "error"}) — skipping.`);
    if (delayMs > 0) await sleep(delayMs);
    return;
  }
  if (chap.notFound) {
    store.pushLog(job, "No chapter 0 (prologue) for this series.");
    if (delayMs > 0) await sleep(delayMs);
    return;
  }
  if (chap.locked || chap.blocked || chap.images.length === 0) {
    store.pushLog(job, "Chapter 0 has no readable pages — skipping prologue.");
    if (delayMs > 0) await sleep(delayMs);
    return;
  }

  const images = chap.images.slice(0, config.MAX_IMAGES_PER_CHAPTER);
  try {
    const prepared = await downloadImages(store, job, 0, images, "Prologue");
    await saveChapter(dir, 0, prepared);
    job.hasPrologue = true;
    store.setChapter(job, 0, {
      status: "done",
      label: "Prologue",
      prologue: true,
      pagesDone: prepared.length,
      pagesTotal: prepared.length,
      reason: null,
    });
    job.pages += prepared.length;
    store.pushLog(job, `Prologue: ${prepared.length} pages`);
    debugChapterDownloaded(job.id, "Prologue", prepared.length);
  } catch (err) {
    store.pushLog(
      job,
      `Prologue: image download failed (${err.status || err.code || "error"}) — skipped.`,
    );
  }
  if (delayMs > 0) await sleep(delayMs);
}

function chapterLabel(job, i) {
  if (job.kind === "atsu") {
    const meta = (job.chapterMeta || [])[i];
    return meta && meta.label != null ? meta.label : meta?.number ?? i + 1;
  }
  if (job.kind !== "generic" || !job.chapterUrls[i]) return i;
  const m =
    job.chapterUrls[i].match(/\/chapter\/(\d+)/) ||
    job.chapterUrls[i].match(/\/chap\/(\d+)/) ||
    job.chapterUrls[i].match(/\/c\/(\d+)/);
  return m ? Number.parseInt(m[1], 10) : i + 1;
}

function chapterKeys(job) {
  return Object.keys(job.chapters)
    .map(Number)
    .sort((a, b) => a - b);
}

function isPrologue(job, key) {
  return Boolean(job.hasPrologue) && Number(key) === 0;
}

function regularChapterKeys(job) {
  return chapterKeys(job).filter((key) => !isPrologue(job, key));
}

function recount(job) {
  const chapters = regularChapterKeys(job)
    .map((key) => job.chapters[key])
    .filter(Boolean);
  job.skipped = chapters.filter((d) => d.status === "skipped").length;
  job.locked = chapters.filter((d) => /locked\/premium/.test(d.reason || "")).length;
}

async function saveChapter(dir, key, images) {
  const chapDir = path.join(dir, `chap-${key}`);
  fs.rmSync(chapDir, { recursive: true, force: true });
  fs.mkdirSync(chapDir, { recursive: true });
  const dimensions = [];
  const writes = images.map((image, i) => {
    const file = `${String(i).padStart(3, "0")}.img`;
    dimensions.push({ file, width: image.width, height: image.height });
    return Promise.resolve().then(() => fs.writeFileSync(path.join(chapDir, file), image.buffer));
  });
  await Promise.all(writes);
  fs.writeFileSync(path.join(chapDir, "meta.json"), JSON.stringify(dimensions));
}

function chapterInfo(dir, key) {
  const chapDir = path.join(dir, `chap-${key}`);
  const files = chapterFiles(dir, key);
  const metaPath = path.join(chapDir, "meta.json");
  if (!fs.existsSync(metaPath)) {
    return { files, dimensions: files.map(() => ({})), prepared: false };
  }
  try {
    const saved = JSON.parse(fs.readFileSync(metaPath, "utf8"));
    const ordered = files.map((file) => ({
      file: path.basename(file),
      width: saved.find((entry) => entry.file === path.basename(file))?.width,
      height: saved.find((entry) => entry.file === path.basename(file))?.height,
    }));
    return { files, dimensions: ordered, prepared: true };
  } catch {
    return { files, dimensions: files.map(() => ({})), prepared: false };
  }
}

function chapterFiles(dir, key) {
  const chapDir = path.join(dir, `chap-${key}`);
  if (!fs.existsSync(chapDir)) return [];
  return fs
    .readdirSync(chapDir)
    .filter((f) => f.endsWith(".img"))
    .sort()
    .map((f) => path.join(chapDir, f));
}

module.exports = { runJob, buildPdf };
