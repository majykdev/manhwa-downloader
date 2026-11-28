"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const config = require("../config");
const asura = require("../scraper/asura");
const atsu = require("../scraper/atsu");
const generic = require("../scraper/generic");
const { parseInputUrl } = require("../scraper/parse");
const { PdfBuilder } = require("../pdf/builder");
const { CbzBuilder, chapterFolder } = require("../cbz/builder");
const {
  SpeedController,
  DynamicLimiter,
  isRateLimitError,
} = require("./speedController");
const { globalThrottle } = require("./globalThrottle");
const {
  debugLog,
  debugChapterDownloaded,
  debugScrapeComplete,
} = require("../debug");
const { mapLimit, sanitizeFilename, chapterDisplayLabel } = require("../util");

const BASE_TMP = path.join(config.DATA_DIR, "jobs");
fs.mkdirSync(BASE_TMP, { recursive: true });

async function runJob(store, job, { retry = false, retryKeys = null, continueJob = false } = {}) {
  job.status = "running";
  job.error = null;
  job.finishedAt = null;
  const dir = job.tmpDir || fs.mkdtempSync(path.join(BASE_TMP, `${job.id}-`));
  job.tmpDir = dir;
  const formats = selectedFormats(job);
  let pdfPath = null;
  let cbzPath = null;
  const speed = new SpeedController(job.settings || {});
  job.speed = speed.snapshot();
  const limiter = new DynamicLimiter(speed.concurrency());
  globalThrottle.setProfile(job.settings?.globalThrottleProfile ?? "balanced");
  globalThrottle.setJobDelay(job.id, speed.delayMs());
  job.throttle = globalThrottle.snapshot();

  const handleFailure = (err) => {
    if (!isRateLimitError(err)) return;
    const firstPenalty = globalThrottle.reportRateLimit();
    if (firstPenalty) store.pushLog(job, "Shared throttle slowed all jobs after a rate limit.");
    speed.reportRateLimit((line) => store.pushLog(job, line));
    limiter.setMax(speed.concurrency());
    job.speed = speed.snapshot();
    job.throttle = globalThrottle.snapshot();
  };

  try {
    await store.waitForResume(job);

    if (!retry && !continueJob) {
      store.setPhase(job, "discovering");
      if (
        job.kind === "generic" ||
        job.kind === "atsu" ||
        (job.kind === "asura" && job.chapterUrls && Object.keys(job.chapterUrls).length > 0)
      ) {
        const specKeys = Object.keys(job.chapterUrls || {})
          .map(Number)
          .sort((a, b) => a - b);
        job.totalChapters = specKeys.length;
        const numbers = specKeys
          .map((key) => Number(job.chapterMeta?.[key]?.number))
          .filter(Number.isFinite);
        if (numbers.length > 0) {
          job.firstChapter = Math.min(...numbers);
          job.lastChapter = Math.max(...numbers);
        }
        for (const key of specKeys) {
          const meta = (job.chapterMeta || {})[key] || {};
          store.setChapter(job, key, {
            status: "pending",
            number: Number.isFinite(Number(meta.number)) ? Number(meta.number) : key,
            label: chapterDisplayLabel(meta.label ?? meta.number ?? chapterLabel(job, key)),
            detail: meta.detail || null,
            parts: meta.parts || null,
            provider: meta.provider || null,
          });
        }
        store.pushLog(job, `Found ${job.totalChapters} chapters.`);
      } else {
        const start = job.startChapter ?? job.firstChapter ?? null;
        let info;
        try {
          info = await asura.discoverRange(job.slug, start, (m) =>
            store.pushLog(job, m),
            job.endChapter ?? null,
          );
        } catch (err) {
          handleFailure(err);
          throw err;
        }
        job.title = info.title;
        job.coverUrl = job.coverUrl || info.coverUrl || null;
        job.firstChapter = info.firstChapter;
        job.lastChapter = info.lastChapter;
        job.totalChapters = info.lastChapter - info.firstChapter + 1;
        for (let ch = info.firstChapter; ch <= info.lastChapter; ch++) {
          store.setChapter(job, ch, {
            status: "pending",
            number: ch,
            label: chapterDisplayLabel(ch),
          });
        }
        store.pushLog(
          job,
          `Found ${job.totalChapters} chapters (${info.firstChapter}–${info.lastChapter}).`,
        );
      }
    }

    const baseName = sanitizeFilename(job.title || job.slug || "comic");
    pdfPath = formats.includes("pdf") ? path.join(dir, `${baseName}.pdf`) : null;
    cbzPath = formats.includes("cbz") ? path.join(dir, `${baseName}.cbz`) : null;
    job.pdfPath = pdfPath;
    job.cbzPath = cbzPath;

    await prepareCover(store, job, dir, handleFailure);
    await store.waitForResume(job);

    store.setPhase(job, "scraping");
    if (job.hasPrologue && (!retry || job.chapters[0]?.status !== "done")) {
      await fetchPrologue(store, job, dir, handleFailure);
    }
    await store.waitForResume(job);

    if (retry || continueJob) {
      job.totalChapters = regularChapterKeys(job).length;
    }
    const todo = retry
      ? store.findRetryable(job, retryKeys).filter((key) => !isPrologue(job, key))
      : continueJob
        ? regularChapterKeys(job).filter((key) => {
            const data = job.chapters[key] || {};
            return data.status !== "done" && !/locked\/premium/.test(data.reason || "");
          })
        : regularChapterKeys(job);
    await Promise.all(
      todo.map((key) =>
        limiter.run(async () => {
          await store.waitForResume(job);
          await processChapter(store, job, key, speed, handleFailure);
        }),
      ),
    );

    store.setPhase(job, "assembling");
    await store.waitForResume(job);
    if (cbzPath) await buildCbz(store, job, cbzPath);
    if (pdfPath) await buildPdf(store, job, pdfPath);
    const built = [];
    if (pdfPath) built.push("PDF");
    if (cbzPath) built.push("CBZ");
    recount(job);
    store.setPhase(job, "done");
    store.finish(job, "complete", { pdfPath, cbzPath, resumable: false });
    const builtNote =
      built.length === 1 && built[0] === "PDF" ? "" : ` (${built.join(" + ")})`;
    store.pushLog(
      job,
      `Done — ${job.pages} pages across ${job.totalChapters} chapters.${builtNote}`,
    );
    debugScrapeComplete(
      job.id,
      job.title || job.slug || "comic",
      job.pages,
      job.totalChapters,
    );
  } catch (err) {
    debugLog("error", `Job ${job.id} fatal: ${err.stack || err.message}`);
    store.pushLog(job, `Fatal: ${err.message} — resume is available.`);
    store.setPhase(job, "failed");
    store.finish(job, "failed", { error: err.message, resumable: true });
  } finally {
    globalThrottle.clearJobDelay(job.id);
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
    await store.waitForResume(job);
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
    const firstPenalty = globalThrottle.reportRateLimit();
    if (firstPenalty) store.pushLog(job, "Shared throttle slowed all jobs after a captcha block.");
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
    await saveChapter(job.tmpDir, key, prepared, job.settings);
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
  const builder = new PdfBuilder(pdfPath, {
    chapterHyperlinks: job.settings?.chapterHyperlinks !== false,
  });
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
    const label = chapterDisplayLabel(data.label ?? chapterLabel(job, key));
    const detail = data.detail || null;
    await addChapter(key, label, detail);
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
    await builder.addCover(fs.readFileSync(coverPath), dimensions, {
      contained: atsu.isGeneratedOgCover(job.coverUrl),
    });
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

async function buildCbz(store, job, cbzPath, { partial = false, doneOnly = false } = {}) {
  const builder = new CbzBuilder(cbzPath);
  let keys = regularChapterKeys(job);
  if (doneOnly) {
    keys = keys.filter(
      (key) =>
        job.chapters[key]?.status === "done" && chapterFiles(job.tmpDir, key).length > 0,
    );
  }

  const coverPath = path.join(job.tmpDir, "cover.img");
  const coverFile = fs.existsSync(coverPath)
    ? coverPath
    : job.coverPath && fs.existsSync(job.coverPath)
      ? job.coverPath
      : null;
  if (coverFile) {
    let dimensions = job.coverDimensions || {};
    try {
      dimensions = JSON.parse(fs.readFileSync(path.join(job.tmpDir, "cover.meta.json"), "utf8"));
    } catch {}
    await builder.addCover(fs.readFileSync(coverFile), dimensions);
  }

  const chapters = [];
  const addChapter = async (key, folder) => {
    const files = chapterFiles(job.tmpDir, key);
    if (files.length === 0) return;
    const info = { ...chapterInfo(job.tmpDir, key), files };
    const added = await builder.addChapter(folder, info);
    if (added > 0) chapters.push(folder);
  };

  const prologueDone = job.chapters[0]?.status === "done";
  if (
    chapterFiles(job.tmpDir, 0).length > 0 &&
    (!doneOnly || prologueDone)
  ) {
    await addChapter(0, "Prologue");
  }

  for (const key of keys) {
    const data = job.chapters[key] || {};
    await addChapter(key, chapterFolder(key, data.number));
  }

  await builder.finish();

  const totalPages = builder.entries.length;
  if (!partial) {
    job.currentPage = totalPages;
    job.pages = totalPages;
  }
  return { pages: totalPages, chapters };
}

function fetchChapterByUrl(url) {
  let kind = "generic";
  try {
    kind = parseInputUrl(url).kind;
  } catch {}
  if (kind === "asura") return asura.fetchChapterFromUrl(url);
  if (kind === "atsu") return atsu.fetchChapter(url);
  return generic.fetchChapter(url);
}

function fetchChap(job, key) {
  const parts = job.chapterParts && job.chapterParts[key];
  if (Array.isArray(parts) && parts.length > 1) {
    return fetchCombinedChapter(parts);
  }
  const url = job.chapterUrls && job.chapterUrls[key];
  if (url) return fetchChapterByUrl(url);
  return asura.fetchChapter(job.slug, key);
}

async function fetchCombinedChapter(urls) {
  const images = [];
  let locked = false;
  let blocked = false;
  let notFound = false;
  let title = null;
  let rendered = false;
  for (const url of urls) {
    const part = await fetchChapterByUrl(url);
    locked = locked || part.locked;
    blocked = blocked || part.blocked;
    notFound = notFound || part.notFound;
    title = title || part.title;
    rendered = rendered || Boolean(part.rendered);
    images.push(...(part.images || []));
  }
  return { images, locked, blocked, notFound, title, rendered };
}

async function downloadImages(store, job, key, images, label) {
  const scale = job.settings?.imageResolutionScale;
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
            referer:
              label === "Prologue"
                ? job.prologueUrl
                : job.chapterUrls
                  ? job.chapterUrls[key]
                  : undefined,
          })
        : null;
      if (viaBrowser && viaBrowser.length > 0) {
        store.pushLog(job, `${label}: fetched image via browser fallback.`);
        buffer = viaBrowser;
      } else {
        throw err;
      }
    }
    await store.waitForResume(job);
    return prepareImage(buffer, scale);
  });
}

async function prepareCover(store, job, dir, handleFailure) {
  const scale = job.settings?.imageResolutionScale;
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
  if (job.uploadedCoverPath && fs.existsSync(job.uploadedCoverPath)) {
    try {
      const prepared = await prepareImage(fs.readFileSync(job.uploadedCoverPath), scale);
      const dimensions = preparedMeta(prepared);
      fs.writeFileSync(coverPath, prepared.buffer);
      fs.writeFileSync(metaPath, JSON.stringify(dimensions));
      job.coverPath = coverPath;
      job.coverDimensions = dimensions;
      store.pushLog(job, "Cover: added from upload.");
      return;
    } catch (err) {
      store.pushLog(job, `Cover: upload failed (${err.message}) — continuing without cover.`);
    }
  }
  if (!job.coverUrl) return;

  let buffer;
  try {
    buffer = await asura.downloadImage(job.coverUrl, () =>
      store.pushLog(job, "Cover: retrying image…"),
    );
  } catch (err) {
    handleFailure(err);
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
    const prepared = await prepareImage(buffer, scale);
    const dimensions = preparedMeta(prepared);
    fs.writeFileSync(coverPath, prepared.buffer);
    fs.writeFileSync(metaPath, JSON.stringify(dimensions));
    job.coverPath = coverPath;
    job.coverDimensions = dimensions;
    store.pushLog(job, "Cover: added.");
  } catch (err) {
    store.pushLog(job, `Cover: prepare failed (${err.message}) — continuing without cover.`);
  }
}

function preparedMeta(prepared) {
  return {
    width: prepared.width,
    height: prepared.height,
    pageWidth: prepared.pageWidth,
    format: prepared.format,
  };
}

async function prepareImage(buffer, scale = 1) {
  const image = sharp(buffer);
  const meta = await image.metadata();
  const naturalWidth = Math.max(1, meta.width || config.PDF_MAX_PAGE_WIDTH);
  const naturalHeight = Math.max(1, meta.height || 1);
  const baseCap = config.PDF_MAX_PAGE_WIDTH * 2;
  const requested = Number(scale);
  const effectiveScale = Math.max(
    1,
    Math.min(Number.isFinite(requested) ? requested : 1, naturalWidth / baseCap),
  );
  const targetWidth = Math.max(1, Math.round(Math.min(naturalWidth, baseCap * effectiveScale)));
  const pageWidth = Math.max(1, Math.round(config.PDF_MAX_PAGE_WIDTH * effectiveScale));
  const sourceFormat = String(meta.format || "").toLowerCase();
  const sourceFormatName = sourceFormat === "jpg" ? "jpeg" : sourceFormat;
  const keepOriginal =
    (sourceFormatName === "jpeg" || sourceFormatName === "png") && targetWidth >= naturalWidth;
  if (keepOriginal) {
    return {
      buffer,
      width: naturalWidth,
      height: naturalHeight,
      pageWidth,
      format: sourceFormatName,
    };
  }

  const height = Math.max(1, Math.round((naturalHeight * targetWidth) / naturalWidth));
  const preservePng = sourceFormatName === "png";
  const resized = image.clone().resize({ width: targetWidth, withoutEnlargement: true });
  const output = preservePng
    ? await resized.png().toBuffer()
    : await resized.jpeg({ quality: config.PREPARED_JPEG_QUALITY || 95 }).toBuffer();
  return {
    buffer: output,
    width: targetWidth,
    height,
    pageWidth,
    format: preservePng ? "png" : "jpeg",
  };
}

async function fetchPrologue(store, job, dir, handleFailure) {
  if (job.hasPrologue) return;
  const prologueUrl =
    job.prologueUrl || (job.kind === "asura" ? asura.chapterUrl(job.slug, 0) : null);
  if (!prologueUrl) return;
  const start = job.startChapter ?? job.firstChapter;
  if (Number.isFinite(start) && Number(start) > 0) return;

  let chap;
  try {
    chap = await fetchChapterByUrl(prologueUrl);
  } catch (err) {
    handleFailure(err);
    store.pushLog(job, `Prologue: check failed (${err.status || err.code || "error"}) — skipping.`);
    return;
  }
  if (chap.notFound) {
    store.pushLog(job, "No chapter 0 (prologue) for this series.");
    return;
  }
  if (chap.blocked) {
    handleFailure({ status: 403 });
    store.pushLog(job, "Chapter 0 has no readable pages — skipping prologue.");
    return;
  }
  if (chap.locked || chap.images.length === 0) {
    store.pushLog(job, "Chapter 0 has no readable pages — skipping prologue.");
    return;
  }

  const images = chap.images.slice(0, config.MAX_IMAGES_PER_CHAPTER);
  try {
    const prepared = await downloadImages(store, job, 0, images, "Prologue");
    await saveChapter(dir, 0, prepared, job.settings);
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
    handleFailure(err);
    store.pushLog(
      job,
      `Prologue: image download failed (${err.status || err.code || "error"}) — skipped.`,
    );
  }
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

function selectedFormats(job) {
  const value = job.settings?.exportFormat;
  const format = typeof value === "string" ? value.trim().toLowerCase() : "pdf";
  const normalized = ["pdf", "cbz", "both"].includes(format) ? format : "pdf";
  if (normalized === "both") return ["pdf", "cbz"];
  if (normalized === "cbz" || (!job.pdfPath && job.cbzPath)) return ["cbz"];
  return ["pdf"];
}

function recount(job) {
  const chapters = regularChapterKeys(job)
    .map((key) => job.chapters[key])
    .filter(Boolean);
  job.skipped = chapters.filter((d) => d.status === "skipped").length;
  job.locked = chapters.filter((d) => /locked\/premium/.test(d.reason || "")).length;
}

async function saveChapter(dir, key, images, settings) {
  const chapDir = path.join(dir, `chap-${key}`);
  fs.rmSync(chapDir, { recursive: true, force: true });
  fs.mkdirSync(chapDir, { recursive: true });
  const dimensions = [];
  const writes = images.map((image, i) => {
    const file = `${String(i).padStart(3, "0")}.img`;
    const entry = {
      file,
      width: image.width,
      height: image.height,
      pageWidth: image.pageWidth,
      format: image.format,
    };
    const rawScale = typeof settings === "number" ? settings : settings?.imageResolutionScale;
    const scale = Number(rawScale);
    if (Number.isFinite(scale) && scale > 0) entry.scale = scale;
    dimensions.push(entry);
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
    const ordered = files.map((file) => {
      const entry = saved.find((item) => item.file === path.basename(file)) || {};
      return {
        file: path.basename(file),
        width: entry.width,
        height: entry.height,
        pageWidth: entry.pageWidth,
        format: entry.format,
      };
    });
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

module.exports = {
  runJob,
  buildPdf,
  buildCbz,
  prepareImage,
  saveChapter,
  chapterInfo,
  chapterFiles,
  regularChapterKeys,
  selectedFormats,
};
