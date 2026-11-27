"use strict";

const fs = require("fs");
const path = require("path");
const express = require("express");
const { parseInputUrl } = require("../scraper/parse");
const { normalizeCoverUrl } = require("../scraper/cover");
const generic = require("../scraper/generic");
const asura = require("../scraper/asura");
const atsu = require("../scraper/atsu");
const { discoveryStore } = require("../jobs/discoveryStore");
const { runJob, buildPdf } = require("../jobs/runner");
const { normalizeChapterRange, inChapterRange } = require("../chapterRange");
const { normalizeSpeedSettings } = require("../jobs/speedController");
const { normalizeProfile } = require("../jobs/globalThrottle");
const {
  debugLog,
  getDebugLog,
  debugPdfDownloaded,
  subscribe: subscribeDebug,
} = require("../debug");
const { sanitizeFilename } = require("../util");
const { clearJobTempFiles } = require("../jobs/store");

function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

function normalizeBoolean(value, fallback) {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1") return true;
    if (normalized === "false" || normalized === "0") return false;
  }
  return fallback;
}

function requestOptions(body) {
  return {
    range: normalizeChapterRange(body),
    settings: {
      ...normalizeSpeedSettings(body.settings || {}),
      globalThrottleProfile: normalizeProfile(body.settings?.globalThrottleProfile),
      chapterHyperlinks: normalizeBoolean(body.settings?.chapterHyperlinks, true),
    },
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

function normalizeHttpUrl(value, label) {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.trim());
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function chapterPreviewLabel(number) {
  const n = Number(number);
  if (n === 0) return "Prologue";
  return Number.isFinite(n) ? `Chapter ${n}` : "Chapter";
}

function includePreviewGroup(group, range) {
  const number = Number(group?.number);
  if (!Number.isFinite(number) || number < 0) return false;
  if (number === 0) return range.startChapter === null || range.startChapter === 0;
  return inChapterRange(number, range, { logical: true });
}

function syntheticOption(kind, number, url) {
  return {
    providerId: kind,
    providerName: kind === "asura" ? "Asura Scans" : "Direct",
    chapterId: null,
    number,
    sourceNumber: number,
    title: null,
    pageCount: null,
    url,
  };
}

function simplePreview(key, number, url, label) {
  return {
    key,
    number,
    label: label || chapterPreviewLabel(number),
    url,
    combined: false,
    parts: null,
    options: [syntheticOption("generic", number, url)],
  };
}

function makeAtasuPreview(discovery) {
  const groups = atsu.logicalChapters(discovery.chapters || []);
  return groups.map((group) => {
    const parts = group.combined
      ? group.parts.map((part) => ({
          ...part,
          key: `${group.number}:${part.number}`,
          label: chapterPreviewLabel(part.number),
          url: part.options?.[0]?.url || null,
          options: (part.options || []).map(publicChapterOption),
        }))
      : null;
    return {
      ...group,
      key: String(group.number),
      label: group.combined ? chapterPreviewLabel(group.number) : chapterPreviewLabel(group.number),
      url: group.options?.[0]?.url || parts?.[0]?.url || null,
      parts,
      options: (group.options || []).map(publicChapterOption),
    };
  });
}

function makeGenericPreview(discovery) {
  return (discovery.chapters || []).map((chapter, index) => {
    const number = Number.isFinite(chapter.num) ? chapter.num : null;
    return simplePreview(
      number === null ? `chapter:${index}` : String(number),
      number,
      chapter.url,
      number === null ? `Chapter ${index + 1}` : chapterPreviewLabel(number),
    );
  });
}

function makeAsuraPreview(discovery, parsed) {
  const chapters = [
    simplePreview("0", 0, asura.chapterUrl(parsed.slug, 0), "Prologue"),
  ];
  const first = Number(discovery.firstChapter);
  const last = Math.min(Number(discovery.lastChapter) || first, 5000);
  for (let number = first; Number.isFinite(number) && number <= last; number += 1) {
    chapters.push(simplePreview(String(number), number, asura.chapterUrl(parsed.slug, number)));
  }
  return chapters;
}

function publicPreviewGroup(group) {
  const preview = {
    key: group.key || String(group.number),
    number: group.number,
    label: group.label || chapterPreviewLabel(group.number),
    url: group.url || group.options?.[0]?.url || null,
    combined: Boolean(group.combined),
    options: (group.options || []).map(publicChapterOption),
  };
  if (group.combined) {
    preview.parts = (group.parts || []).map((part) => publicPreviewGroup(part));
  }
  return preview;
}

function publicDiscovery(discovery, token) {
  const chapters = (discovery.chapters || [])
    .filter((group) => includePreviewGroup(group, discovery.requestedRange || {}))
    .map(publicPreviewGroup);

  return {
    supported: true,
    detectedKind: discovery.kind,
    discoveryToken: token,
    title: discovery.title,
    coverUrl: discovery.coverUrl || null,
    medium: discovery.medium || null,
    providers: (discovery.providers || []).map((provider) => ({ ...provider })),
    chapters,
      defaults: {
        sourceOrder: (discovery.providers || []).map((provider) => provider.id),
        enabledSourceIds: (discovery.providers || []).map((provider) => provider.id),
        chapterOverrides: {},
        excludedPartKeys: [],
      },
    log: discovery.log || [],
  };
}

function normalizeChapterEdits(body, range) {
  const rawOverrides = body?.chapterUrlOverrides;
  if (rawOverrides != null && (typeof rawOverrides !== "object" || Array.isArray(rawOverrides))) {
    throw new Error("Chapter URL overrides must be an object.");
  }
  const overrides = {};
  for (const [key, value] of Object.entries(rawOverrides || {})) {
    const url = normalizeHttpUrl(value, `Chapter ${key}`);
    if (!url) throw new Error(`Invalid custom chapter URL for "${key}".`);
    overrides[String(key)] = url;
  }

  const rawAdded = body?.addedChapters;
  if (rawAdded != null && !Array.isArray(rawAdded)) {
    throw new Error("Added chapters must be a list.");
  }
  const added = [];
  const seen = new Set();
  for (const entry of rawAdded || []) {
    const url = normalizeHttpUrl(entry?.url, "Added chapter");
    if (!url) throw new Error("Added chapters need a valid http(s) URL.");
    let number = Number(entry?.number);
    if (!Number.isFinite(number) || number < 0) {
      number = Number(generic.extractChapterNum(url));
    }
    if (!Number.isFinite(number) || number < 0) {
      throw new Error("Could not find a chapter number in that URL.");
    }
    const key = String(number);
    if (seen.has(key)) continue;
    seen.add(key);
    added.push({
      key: number === 0 ? "0" : `added:${number}`,
      number,
      label: entry?.label || chapterPreviewLabel(number),
      url,
    });
  }

  return {
    overrides,
    added: added.filter((chapter) => includePreviewGroup(chapter, range)),
  };
}

function normalizeExcludedPartKeys(value) {
  if (value == null) return [];
  if (!Array.isArray(value)) {
    throw new Error("Excluded part keys must be a list.");
  }
  const keys = new Set();
  for (const entry of value) {
    if (typeof entry !== "string" || !/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(entry)) {
      throw new Error("Excluded part keys must look like \"2:2.5\".");
    }
    keys.add(entry);
  }
  return [...keys];
}

function buildPreviewJobSpec(discovery, edits, range) {
  const chapters = (discovery.chapters || [])
    .filter((chapter) => includePreviewGroup(chapter, range))
    .filter((chapter) => Number(chapter.number) !== 0);
  const byNumber = new Map();
  for (const chapter of chapters) {
    byNumber.set(String(chapter.number), { ...chapter });
  }
  for (const chapter of edits.added) {
    if (Number(chapter.number) === 0) continue;
    const key = String(chapter.number);
    const existing = byNumber.get(key);
    byNumber.set(key, existing ? { ...existing, url: chapter.url, label: chapter.label } : { ...chapter });
  }

  const final = [...byNumber.values()].sort((a, b) => Number(a.number) - Number(b.number));
  const chapterUrls = [];
  const chapterMeta = [];
  for (const chapter of final) {
    const override = edits.overrides[chapter.key] || edits.overrides[String(chapter.number)];
    const url = override || chapter.url;
    if (!url) continue;
    chapterUrls.push(url);
    chapterMeta.push({
      number: Number.isFinite(Number(chapter.number)) ? Number(chapter.number) : undefined,
      label: chapter.label || chapterPreviewLabel(chapter.number),
      url,
    });
  }

  const prologue = (discovery.chapters || []).find((chapter) => Number(chapter.number) === 0);
  const addedPrologue = edits.added.find((chapter) => Number(chapter.number) === 0);
  const prologueOverride = edits.overrides["0"] || edits.overrides[prologue?.key];
  const prologueUrl = prologueOverride || addedPrologue?.url || prologue?.url || null;

  return {
    title: discovery.title,
    coverUrl: discovery.coverUrl || null,
    chapterUrls,
    chapterMeta,
    chapterParts: {},
    prologueUrl,
    log: [`Selected ${chapterMeta.length} chapters.`],
  };
}

function applyEditsToAtsuSpec(spec, edits) {
  for (let i = 0; i < spec.chapterUrls.length; i += 1) {
    const meta = spec.chapterMeta[i] || {};
    const number = meta.number;
    const wholeOverride = edits.overrides[String(number)];
    if (wholeOverride) {
      spec.chapterUrls[i] = wholeOverride;
      delete spec.chapterParts[i];
      Object.assign(meta, {
        label: chapterPreviewLabel(number),
        detail: null,
        parts: null,
        partNumbers: null,
        combined: false,
      });
      continue;
    }
    const parts = spec.chapterParts[i];
    const partNumbers = meta.partNumbers || meta.parts || [];
    if (Array.isArray(parts) && partNumbers.length > 0) {
      for (let p = 0; p < partNumbers.length; p += 1) {
        const override = edits.overrides[`${number}:${partNumbers[p]}`];
        if (!override) continue;
        parts[p] = override;
        if (p === 0) spec.chapterUrls[i] = override;
      }
    }
  }

  for (const chapter of edits.added) {
    if (Number(chapter.number) === 0) {
      spec.prologueUrl = edits.overrides["0"] || chapter.url;
      continue;
    }
    const override = edits.overrides[chapter.key];
    spec.chapterUrls.push(override || chapter.url);
    spec.chapterMeta.push({
      number: chapter.number,
      label: chapter.label || chapterPreviewLabel(chapter.number),
      url: override || chapter.url,
    });
  }

  if (edits.overrides["0"]) spec.prologueUrl = edits.overrides["0"];
  return spec;
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
      const log = [];
      let discovery;
      let chapters;
      try {
        if (parsed.kind === "atsu") {
          discovery = await atsu.discoverSeries(parsed, firstChapterUrl || null, (m) => log.push(m));
          if (!discovery.needFirstChapter) chapters = makeAtasuPreview(discovery);
        } else if (parsed.kind === "generic") {
          discovery = await generic.discoverSeries(
            parsed.sourceUrl,
            firstChapterUrl || null,
            (m) => log.push(m),
          );
          if (!discovery.needFirstChapter) chapters = makeGenericPreview(discovery);
        } else {
          discovery = await asura.discoverRange(
            parsed.slug,
            range.startChapter ?? null,
            (m) => log.push(m),
            range.endChapter ?? null,
          );
          chapters = makeAsuraPreview(discovery, parsed);
        }
      } catch (err) {
        debugLog("error", `Discovery failed for ${parsed.sourceUrl}: ${err.message}`);
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

      const preview = {
        kind: parsed.kind,
        sourceUrl: parsed.kind === "asura" ? parsed.baseUrl : parsed.sourceUrl,
        slug: parsed.slug || null,
        mangaId: discovery.mangaId || parsed.slug || null,
        medium: discovery.medium || null,
        title: discovery.title || parsed.slug || "comic",
        coverUrl: discovery.coverUrl || null,
        firstChapterUrl: discovery.firstChapterUrl || firstChapterUrl || null,
        chapters,
        providers: discovery.providers || [],
        raw: discovery,
        log,
        requestedRange: range,
        requestedSettings: settings,
      };
      const token = discoveryStore.create(preview);
      res.json(publicDiscovery(preview, token));
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
      const storedDiscovery = discoveryToken ? discoveryStore.get(discoveryToken) : null;
      if (discoveryToken && !storedDiscovery) {
        return res.status(400).json({ error: "Source selection expired. Search again." });
      }
      const hasExplicitRange =
        body.startChapter !== undefined && body.startChapter !== null && body.startChapter !== "" ||
        body.endChapter !== undefined && body.endChapter !== null && body.endChapter !== "";
      const effectiveRange = hasExplicitRange ? range : storedDiscovery?.requestedRange || range;
      const customCoverUrl = body.coverUrl
        ? normalizeCoverUrl(normalizeHttpUrl(body.coverUrl, "Cover"))
        : null;
      if (body.coverUrl && !customCoverUrl) {
        return res.status(400).json({ error: "Cover image URL must be http(s)." });
      }
      let edits;
      let excludedPartKeys;
      try {
        edits = normalizeChapterEdits(body, effectiveRange);
        excludedPartKeys = normalizeExcludedPartKeys(body.excludedPartKeys);
      } catch (err) {
        return res.status(400).json({ error: err.message });
      }
      let job;

      if (storedDiscovery) {
        const discovery = storedDiscovery;
        let spec;
        if (discovery.kind === "atsu") {
          spec = atsu.buildJobSpec(discovery, {
            sourceOrder: body.sourceOrder,
            enabledSourceIds: body.enabledSourceIds,
            chapterOverrides: body.chapterOverrides,
            excludedPartKeys,
            ...effectiveRange,
          });
          applyEditsToAtsuSpec(spec, edits);
        } else {
          spec = buildPreviewJobSpec(discovery, edits, effectiveRange);
        }
        if (spec.chapterUrls.length === 0) {
          return res.status(400).json({ error: "No chapters matched that range." });
        }
        job = store.create({
          url: discovery.sourceUrl,
          kind: discovery.kind,
          slug: discovery.kind === "asura" ? discovery.slug : discovery.mangaId,
          medium: discovery.medium,
          title: discovery.title,
          coverUrl: customCoverUrl || spec.coverUrl || discovery.coverUrl || null,
          chapterUrls: spec.chapterUrls,
          chapterMeta: spec.chapterMeta,
          chapterParts: spec.chapterParts || {},
          prologueUrl: spec.prologueUrl,
          firstChapterUrl: discovery.firstChapterUrl || null,
          settings,
          startChapter: effectiveRange.startChapter,
          endChapter: effectiveRange.endChapter,
          log: [...(discovery.log || []), ...(spec.log || [])],
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
            coverUrl: customCoverUrl || disc.coverUrl || null,
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
            coverUrl: customCoverUrl || spec.coverUrl || discovery.coverUrl || null,
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
            coverUrl: customCoverUrl || null,
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
      if (job.tempCleaned) {
        job.tempCleaned = false;
        job.hasPrologue = false;
        job.pages = 0;
        job.currentPage = 0;
        job.skipped = 0;
        job.locked = 0;
        for (const data of Object.values(job.chapters || {})) {
          data.status = "pending";
          data.pagesDone = 0;
          data.pagesTotal = 0;
          data.reason = null;
        }
        store.pushLog(job, "Rebuilding PDF from source after temp cleanup…");
        setImmediate(() => runJob(store, job));
        res.status(202).json({ jobId: job.id });
        return;
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

  router.post(
    "/jobs/:id/pause",
    asyncHandler(async (req, res) => {
      const job = store.get(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found." });
      if (job.status !== "running") {
        return res.status(409).json({ error: "Only exporting jobs can be paused." });
      }
      if (!job.userPaused) store.pushLog(job, "Paused by user.");
      store.setUserPause(job, true);
      res.json(store.snapshot(job.id));
    }),
  );

  router.post(
    "/jobs/:id/resume",
    asyncHandler(async (req, res) => {
      const job = store.get(req.params.id);
      if (!job) return res.status(404).json({ error: "Job not found." });
      if (job.status !== "running" || !job.userPaused) {
        return res.status(409).json({ error: "Job is not paused." });
      }
      store.setUserPause(job, false);
      store.pushLog(job, "Resumed by user.");
      res.json(store.snapshot(job.id));
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
        return res.download(job.pdfPath, filename, (err) => {
          if (!err) clearJobTempFiles(job);
        });
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
        return res.download(partialPath, filename, (err) => {
          if (err) return;
          job.partialPaths = (job.partialPaths || []).filter((p) => p !== partialPath);
          try {
            fs.rmSync(partialPath, { force: true });
          } catch {}
        });
      }

      res.status(409).json({ error: "PDF is not ready yet." });
    }),
  );

  return router;
}

module.exports = {
  createApiRouter,
  publicDiscovery,
  makeAsuraPreview,
  makeGenericPreview,
  normalizeChapterEdits,
  normalizeExcludedPartKeys,
  buildPreviewJobSpec,
  applyEditsToAtsuSpec,
};
