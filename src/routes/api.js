"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const { parseInputUrl } = require("../scraper/parse");
const generic = require("../scraper/generic");
const atsu = require("../scraper/atsu");
const { discoveryStore } = require("../jobs/discoveryStore");
const { runJob, buildPdf } = require("../jobs/runner");
const { normalizeChapterRange, inChapterRange } = require("../chapterRange");
const { normalizeSpeedSettings } = require("../jobs/speedController");
const {
  debugLog,
  getDebugLog,
  debugPdfDownloaded,
  subscribe: subscribeDebug,
} = require("../debug");
const { sanitizeFilename } = require("../util");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function requestOptions(body) {
  return {
    range: normalizeChapterRange(body),
    settings: normalizeSpeedSettings(body.settings || {}),
  };
}

function publicChapterOption(option) {
  return {
    providerId: option.providerId,
    providerName: option.providerName,
    chapterId: option.chapterId,
    number: option.number,
    sourceNumber: option.sourceNumber ?? option.number,
    title: option.title,
    pageCount: option.pageCount,
    url: option.url,
  };
}

function publicDiscovery(discovery, token, range) {
  const groups = atsu
    .logicalChapters(discovery.chapters)
    .filter((group) => inChapterRange(group.number, range));

  return {
    supported: true,
    detectedKind: "atsu",
    discoveryToken: token,
    title: discovery.title,
    medium: discovery.medium,
    providers: discovery.providers.map((provider) => ({ ...provider })),
    chapters: groups.map((group) => {
      if (group.combined) {
        return {
          number: group.number,
          combined: true,
          parts: group.parts.map((part) => ({
            number: part.number,
            options: part.options.map(publicChapterOption),
          })),
          options: group.options.map(publicChapterOption),
        };
      }
      return {
        number: group.number,
        options: group.options.map(publicChapterOption),
      };
    }),
    defaults: {
      sourceOrder: discovery.providers.map((provider) => provider.id),
      enabledSourceIds: discovery.providers.map((provider) => provider.id),
      chapterOverrides: {},
    },
    log: discovery.log || [],
  };
}

function createApiRouter(store) {
  const router = express.Router();

  router.post(
    "/discover",
    asyncHandler(async (req, res) => {
      const { url, firstChapterUrl } = req.body || {};
      let range;
      let settings;
      try {
        const options = requestOptions(req.body || {});
        range = options.range;
        settings = options.settings;
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      let parsed;
      try {
        parsed = parseInputUrl(url);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      if (parsed.kind !== "atsu") {
        return res.json({ supported: false, detectedKind: parsed.kind });
      }

      const log = [];
      let discovery;
      try {
        discovery = await atsu.discoverSeries(parsed, firstChapterUrl || null, (m) => log.push(m));
      } catch (err) {
        debugLog("error", `Atsu discovery failed for ${parsed.sourceUrl}: ${err.message}`);
        return res.status(400).json({ error: err.message });
      }
      if (discovery.needFirstChapter) {
        return res.status(422).json({
          code: "NEED_FIRST_CHAPTER",
          error:
            "Could not find the first chapter on that page. Paste the direct link to the first chapter below.",
          log,
        });
      }
      discovery.log = log;
      discovery.requestedRange = range;
      discovery.requestedSettings = settings;
      const token = discoveryStore.create(discovery);
      res.json(publicDiscovery(discovery, token, range));
    }),
  );

  router.post(
    "/scrape",
    asyncHandler(async (req, res) => {
      const body = req.body || {};
      const { url, firstChapterUrl, discoveryToken } = body;
      let range;
      let settings;
      try {
        const options = requestOptions(body);
        range = options.range;
        settings = options.settings;
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      const hasExplicitRange =
        body.startChapter !== undefined && body.startChapter !== null && body.startChapter !== "" ||
        body.endChapter !== undefined && body.endChapter !== null && body.endChapter !== "";
      const effectiveRange = hasExplicitRange ? range : discoveryToken ? discoveryStore.get(discoveryToken)?.requestedRange || range : range;
      let job;

      if (discoveryToken) {
        const discovery = discoveryStore.get(discoveryToken);
        if (!discovery) {
          return res.status(400).json({ error: "Source selection expired. Search again." });
        }
        const spec = atsu.buildJobSpec(discovery, {
          sourceOrder: body.sourceOrder,
          enabledSourceIds: body.enabledSourceIds,
          chapterOverrides: body.chapterOverrides,
          ...effectiveRange,
        });
        if (spec.chapterUrls.length === 0) {
          return res.status(400).json({ error: "No chapters matched that range." });
        }
        job = store.create({
          url: discovery.sourceUrl,
          kind: "atsu",
          slug: discovery.mangaId,
          medium: discovery.medium,
          title: discovery.title,
          chapterUrls: spec.chapterUrls,
          chapterMeta: spec.chapterMeta,
          chapterParts: spec.chapterParts,
          prologueUrl: spec.prologueUrl,
          settings,
          startChapter: effectiveRange.startChapter,
          endChapter: effectiveRange.endChapter,
          log: [...(discovery.log || []), ...spec.log],
        });
      } else {
        let parsed;
        try {
          parsed = parseInputUrl(url);
        } catch (err) {
          return res.status(400).json({ error: err.message });
        }

        if (parsed.kind === "generic") {
          const discoveryLog = [];
          let disc;
          try {
            disc = await generic.discoverSeries(parsed.sourceUrl, firstChapterUrl || null, (m) =>
              discoveryLog.push(m),
            );
          } catch (err) {
            debugLog("error", `Discovery failed for ${parsed.sourceUrl}: ${err.message}`);
            return res.status(400).json({ error: err.message });
          }
          if (disc.needFirstChapter) {
            return res.status(422).json({
              code: "NEED_FIRST_CHAPTER",
              error:
                "Could not find the first chapter on that page. Paste the direct link to the first chapter below.",
              log: discoveryLog,
            });
          }
          const chapters = (disc.chapters || []).filter((chapter) =>
            inChapterRange(chapter.num, effectiveRange),
          );
          if (chapters.length === 0) {
            return res.status(400).json({ error: "No chapters matched that range." });
          }
          job = store.create({
            url: parsed.sourceUrl,
            kind: "generic",
            title: disc.title,
            chapterUrls: chapters.map((c) => c.url),
            chapterMeta: chapters.map((c) => ({
              number: Number.isFinite(c.num) ? c.num : undefined,
            })),
            firstChapterUrl: disc.firstChapterUrl,
            settings,
            startChapter: effectiveRange.startChapter,
            endChapter: effectiveRange.endChapter,
            log: discoveryLog,
          });
        } else if (parsed.kind === "atsu") {
          const discoveryLog = [];
          let discovery;
          try {
            discovery = await atsu.discoverSeries(parsed, firstChapterUrl || null, (m) =>
              discoveryLog.push(m),
            );
          } catch (err) {
            debugLog("error", `Atsu discovery failed for ${parsed.sourceUrl}: ${err.message}`);
            return res.status(400).json({ error: err.message });
          }
          if (discovery.needFirstChapter) {
            return res.status(422).json({
              code: "NEED_FIRST_CHAPTER",
              error:
                "Could not find the first chapter on that page. Paste the direct link to the first chapter below.",
              log: discoveryLog,
            });
          }
          discovery.log = discoveryLog;
          const spec = atsu.buildJobSpec(discovery, { ...effectiveRange });
          if (spec.chapterUrls.length === 0) {
            return res.status(400).json({ error: "No chapters matched that range." });
          }
          job = store.create({
            url: discovery.sourceUrl,
            kind: "atsu",
            slug: discovery.mangaId,
            medium: discovery.medium,
            title: discovery.title,
            chapterUrls: spec.chapterUrls,
            chapterMeta: spec.chapterMeta,
            chapterParts: spec.chapterParts,
            prologueUrl: spec.prologueUrl,
            settings,
            startChapter: effectiveRange.startChapter,
            endChapter: effectiveRange.endChapter,
            log: [...discoveryLog, ...spec.log],
          });
        } else {
          job = store.create({
            url: parsed.sourceUrl,
            kind: "asura",
            slug: parsed.slug,
            firstChapter: parsed.chapter ?? null,
            settings,
            startChapter: effectiveRange.startChapter,
            endChapter: effectiveRange.endChapter,
          });
        }
      }

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
      setImmediate(() => runJob(store, job, { retry: true }));
      res.status(202).json({ jobId: job.id });
    }),
  );

  router.get(
    "/debug/log",
    (_req, res) => {
      res.json({ entries: getDebugLog() });
    },
  );

  router.get(
    "/debug/events",
    (req, res) => {
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      const send = (entry) => res.write(`data: ${JSON.stringify(entry)}\n\n`);
      const unsubscribe = subscribeDebug(send);
      const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
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
    "/jobs/:id/events",
    (req, res) => {
      const snap = store.snapshot(req.params.id);
      if (!snap) return res.status(404).json({ error: "Job not found." });
      res.setHeader("Content-Type", "text/event-stream");
      res.setHeader("Cache-Control", "no-cache");
      res.setHeader("Connection", "keep-alive");
      res.flushHeaders?.();
      const send = (update) => res.write(`data: ${JSON.stringify(update)}\n\n`);
      send(snap);
      const unsubscribe = store.subscribe(req.params.id, send);
      const heartbeat = setInterval(() => res.write(": ping\n\n"), 15_000);
      req.on("close", () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  );

  router.get(
    "/jobs/:id/download",
    asyncHandler(async (req, res) => {
      const job = store.get(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found." });
      const baseName = sanitizeFilename(job.title || job.slug || "comic");

      if (job.status === "complete" && job.pdfPath && fs.existsSync(job.pdfPath)) {
        const filename = `${baseName}.pdf`;
        debugPdfDownloaded(job.id, job.title || job.slug || "comic", filename);
        return res.download(job.pdfPath, filename);
      }

      const snap = store.snapshot(job.id);
      if (snap.completedChapters > 0 && job.tmpDir) {
        const partialPath = path.join(job.tmpDir, `partial-${Date.now()}.pdf`);
        (job.partialPaths ||= []).push(partialPath);
        store.setDownloadPause(job, true);
        try {
          await buildPdf(store, job, partialPath, { partial: true, doneOnly: true });
        } finally {
          store.setDownloadPause(job, false);
        }
        const filename = `${baseName}-partial.pdf`;
        debugPdfDownloaded(job.id, job.title || job.slug || "comic", filename);
        return res.download(partialPath, filename);
      }

      res.status(409).json({ error: "PDF is not ready yet." });
    }),
  );

  return router;
}

module.exports = { createApiRouter };
