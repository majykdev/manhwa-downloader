"use strict";

const fs = require("fs");
const os = require("os");
const path = require("path");
const config = require("../config");
const asura = require("../scraper/asura");
const generic = require("../scraper/generic");
const { PdfBuilder } = require("../pdf/builder");
const { sleep, mapLimit, sanitizeFilename } = require("../util");

const BASE_TMP = fs.mkdtempSync(path.join(os.tmpdir(), "asura-dl-"));

/**
 * Executes a scrape job end-to-end: discover range -> per-chapter scrape and
 * image download to temp disk -> streaming PDF build from all chapters.
 *
 * With `retry`, discovery is skipped and only image-failed chapters are
 * re-scraped before the whole PDF is rebuilt from disk.
 */
async function runJob(store, job, { retry = false } = {}) {
  job.status = "running";
  job.error = null;
  job.finishedAt = null;
  const dir = job.tmpDir || fs.mkdtempSync(path.join(BASE_TMP, `${job.id}-`));
  job.tmpDir = dir;
  let pdfPath = null;

  try {
    if (!retry) {
      if (job.kind === "generic") {
        job.totalChapters = (job.chapterUrls || []).length;
        for (let i = 0; i < job.totalChapters; i++) {
          const label = chapterLabel(job, i);
          store.setChapter(job, i, { status: "pending", label });
        }
        store.pushLog(job, `Found ${job.totalChapters} chapters.`);
      } else {
        const info = await asura.discoverRange(job.slug, job.firstChapter, (m) =>
          store.pushLog(job, m),
        );
        job.title = info.title;
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

    const todo = retry ? store.findRetryable(job) : chapterKeys(job);
    for (const key of todo) {
      if (retry) {
        store.setChapter(job, key, {
          status: "scraping",
          pagesDone: 0,
          pagesTotal: 0,
          reason: null,
        });
      } else {
        store.setChapter(job, key, { status: "scraping", pagesDone: 0, pagesTotal: 0, reason: null });
      }
      job.currentChapter = key;

      const label = (job.chapters[key] && job.chapters[key].label) ?? key;

      let chap;
      try {
        chap = await fetchChap(job, key);
      } catch (err) {
        const reason = `load failed (${err.status || err.code || "error"})`;
        store.pushLog(job, `${label}: failed to load (${err.status || err.code || "error"}) — skipped.`);
        store.setChapter(job, key, { status: "skipped", reason });
        job.skipped += 1;
        await sleep(config.CHAPTER_DELAY_MS);
        continue;
      }

      if (chap.notFound) {
        store.pushLog(job, `${label}: not found — skipped.`);
        store.setChapter(job, key, { status: "skipped", reason: "not found" });
        job.skipped += 1;
        await sleep(config.CHAPTER_DELAY_MS);
        continue;
      }
      if (chap.locked) {
        store.pushLog(job, `${label}: locked/premium — skipped.`);
        store.setChapter(job, key, { status: "skipped", reason: "locked/premium" });
        job.locked += 1;
        job.skipped += 1;
        await sleep(config.CHAPTER_DELAY_MS);
        continue;
      }
      if (chap.blocked) {
        store.pushLog(job, `${label}: blocked by captcha — skipped.`);
        store.setChapter(job, key, { status: "skipped", reason: "blocked by captcha" });
        job.skipped += 1;
        job.locked += 1;
        await sleep(config.CHAPTER_DELAY_MS);
        continue;
      }
      if (chap.images.length === 0) {
        store.pushLog(job, `${label}: no pages found — skipped.`);
        store.setChapter(job, key, { status: "skipped", reason: "no pages found" });
        job.skipped += 1;
        await sleep(config.CHAPTER_DELAY_MS);
        continue;
      }

      const images = chap.images.slice(0, config.MAX_IMAGES_PER_CHAPTER);
      store.setChapter(job, key, { pagesTotal: images.length });
      try {
        const buffers = await mapLimit(
          images,
          config.IMAGE_PARALLELISM,
          async (url) => {
            try {
              return await asura.downloadImage(url, () =>
                store.pushLog(job, `${label}: retrying image…`),
              );
            } catch (err) {
              // Hotlink-protected / signed CDNs often reject plain axios but
              // serve fine to a real browser context (cookies + referer).
              const viaBrowser = generic.fetchViaBrowser
                ? await generic.fetchViaBrowser(url, { referer: job.chapterUrls ? job.chapterUrls[key] : undefined })
                : null;
              if (viaBrowser && viaBrowser.length > 0) {
                store.pushLog(job, `${label}: fetched image via browser fallback.`);
                return viaBrowser;
              }
              throw err;
            }
          },
        );
        await saveChapter(dir, key, buffers);
        store.setChapter(job, key, { status: "done", pagesDone: buffers.length });
        job.pages += buffers.length;
        store.pushLog(job, `${label}: ${buffers.length} pages`);
      } catch (err) {
        const reason = `image download failed (${err.status || err.code || "error"})`;
        store.pushLog(job, `${label}: ${reason} — chapter skipped.`);
        store.setChapter(job, key, { status: "skipped", reason });
        job.skipped += 1;
      }

      await sleep(config.CHAPTER_DELAY_MS);
    }

    await buildPdf(store, job, pdfPath);
    store.finish(job, "complete", { pdfPath });
    store.pushLog(
      job,
      `Done — ${job.pages} pages across ${job.totalChapters} chapters.`,
    );
  } catch (err) {
    store.pushLog(job, `Fatal: ${err.message}`);
    if (pdfPath) {
      try {
        fs.rmSync(pdfPath, { force: true });
      } catch {}
    }
    store.finish(job, "failed", { error: err.message });
    return;
  }
}

/**
 * Rebuild the PDF from every chapter's saved images, in reading order, with a
 * spacer page ahead of each chapter (except the very first).
 */
async function buildPdf(store, job, pdfPath) {
  const builder = new PdfBuilder(pdfPath);
  const keys = chapterKeys(job);
  job.currentPage = 0;
  let imagePages = 0;
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i];
    const label = (job.chapters[key] && job.chapters[key].label) ?? key;
    if (i > 0) builder.addSpacer(label);
    const files = chapterFiles(job.tmpDir, key);
    for (const f of files) {
      const buf = fs.readFileSync(f);
      await builder.addImage(buf);
      job.currentPage += 1;
      imagePages += 1;
      if (!job.chapters[key]) store.setChapter(job, key, { status: "done" });
    }
  }
  await builder.finish();
  job.pages = imagePages;
}

function fetchChap(job, key) {
  if (job.kind === "generic") {
    return generic.fetchChapter(job.chapterUrls[key]);
  }
  return asura.fetchChapter(job.slug, key);
}

function chapterLabel(job, i) {
  if (job.kind !== "generic" || !job.chapterUrls[i]) return i;
  const m = job.chapterUrls[i].match(/\/chapter\/(\d+)/) || job.chapterUrls[i].match(/\/chap\/(\d+)/) || job.chapterUrls[i].match(/\/c\/(\d+)/);
  return m ? Number.parseInt(m[1], 10) : i + 1;
}

function chapterKeys(job) {
  return Object.keys(job.chapters)
    .map(Number)
    .sort((a, b) => a - b);
}

async function saveChapter(dir, key, buffers) {
  const chapDir = path.join(dir, `chap-${key}`);
  fs.rmSync(chapDir, { recursive: true, force: true });
  fs.mkdirSync(chapDir, { recursive: true });
  const writes = buffers.map((buf, i) => {
    const file = path.join(chapDir, `${String(i).padStart(3, "0")}.img`);
    return Promise.resolve().then(() => fs.writeFileSync(file, buf));
  });
  await Promise.all(writes);
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