"use strict";

const express = require("express");
const { parseInputUrl } = require("../scraper/parse");
const generic = require("../scraper/generic");
const { runJob } = require("../jobs/runner");
const { sanitizeFilename } = require("../util");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function createApiRouter(store) {
  const router = express.Router();

  router.post(
    "/scrape",
    asyncHandler(async (req, res) => {
      const { url, firstChapterUrl } = req.body || {};
      let parsed;
      try {
        parsed = parseInputUrl(url);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }

      let job;
      if (parsed.kind === "generic") {
        let disc;
        try {
          disc = await generic.discoverSeries(parsed.sourceUrl, firstChapterUrl || null);
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }
        if (disc.needFirstChapter) {
          return res.status(422).json({
            code: "NEED_FIRST_CHAPTER",
            error:
              "Could not find the first chapter on that page. Paste the direct link to the first chapter below.",
          });
        }
        job = store.create({
          url: parsed.sourceUrl,
          kind: "generic",
          title: disc.title,
          chapterUrls: disc.chapters.map((c) => c.url),
          firstChapterUrl: disc.firstChapterUrl,
        });
      } else {
        job = store.create({
          url: parsed.sourceUrl,
          kind: "asura",
          slug: parsed.slug,
          firstChapter: parsed.chapter ?? 0,
        });
      }

      // Fire and forget: progress is polled via GET /api/jobs/:id
      setImmediate(() => runJob(store, job));
      res.status(202).json({ jobId: job.id });
    }),
  );

  router.post(
    "/jobs/:id/retry",
    asyncHandler(async (req, res) => {
      const job = store.get(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found." });
      if (job.status !== "complete") {
        return res.status(409).json({ error: "Job has not finished yet." });
      }
      const retryable = store.findRetryable(job);
      if (retryable.length === 0) {
        return res.status(409).json({ error: "No chapters to retry." });
      }
      store.pushLog(job, `Retrying ${retryable.length} chapter(s)…`);
      // Reset counters so a rebuilt PDF reports accurate totals.
      job.pages = 0;
      job.skipped = Object.entries(job.chapters).filter(
        ([, d]) => d.status === "skipped" && !/image download failed/.test(d.reason || ""),
      ).length;
      job.locked = Object.entries(job.chapters).filter(
        ([, d]) => /locked\/premium/.test(d.reason || ""),
      ).length;
      setImmediate(() => runJob(store, job, { retry: true }));
      res.status(202).json({ jobId: job.id });
    }),
  );

  router.get(
    "/jobs/:id",
    asyncHandler(async (req, res) => {
      const snap = store.snapshot(req.params.id);
      if (!snap) return res.status(404).json({ error: "Job not found." });
      res.json(snap);
    }),
  );

  router.get(
    "/jobs/:id/download",
    asyncHandler(async (req, res) => {
      const job = store.get(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found." });
      if (job.status !== "complete" || !job.pdfPath) {
        return res.status(409).json({ error: "PDF is not ready yet." });
      }
      const filename = `${sanitizeFilename(job.title || job.slug || "comic")}.pdf`;
      res.download(job.pdfPath, filename);
    }),
  );

  return router;
}

module.exports = { createApiRouter };