"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../config");
const { globalThrottle } = require("./globalThrottle");
const { persistence: defaultPersistence } = require("./persistence");

/**
 * In-memory job registry. Suitable for a single server instance
 * (Render/Railway/Fly web service). Swap for Redis if scaling to
 * multiple instances.
 */
class JobStore {
  constructor({ persistence = defaultPersistence, restore = true, persist = true } = {}) {
    this.jobs = new Map();
    this.listeners = new Map();
    this.persistence = persistence;
    this.persist = persist;
    this._ticker = setInterval(() => this._sweep(), 60_000);
    this._ticker.unref?.();
    if (restore) this.restore();
  }

  restore() {
    for (const saved of this.persistence.loadJobs()) {
      if (saved.status === "running" || saved.status === "queued") {
        saved.status = "failed";
        saved.phase = "interrupted";
        saved.error = "Interrupted by restart; resume available.";
        saved.finishedAt = Date.now();
        saved.resumable = true;
      }
      saved.userPaused = false;
      saved.downloadPaused = false;
      saved.pauseWaiters = [];
      this.jobs.set(saved.id, saved);
      this.persistence.saveJob(saved);
    }
  }

  _persist(job) {
    if (this.persist) this.persistence.saveJob(job);
  }

  create(initial = {}) {
    const createdAt = Date.now();
    const job = {
      id: crypto.randomBytes(8).toString("hex"),
      url: null,
      slug: null,
      title: null,
      coverUrl: null,
      coverPath: null,
      uploadedCoverPath: null,
      coverDimensions: null,
      kind: "asura",
      medium: null,
      chapterUrls: null,
      chapterMeta: [],
      firstChapterUrl: null,
      prologueUrl: null,
      hasPrologue: false,
      status: "queued", // queued | running | complete | failed
      phase: "discovering",
      resumable: false,
      seriesKey: null,
      settings: null,
      speed: null,
      startChapter: null,
      endChapter: null,
      partialPaths: [],
      tempCleaned: false,
      downloadPaused: false,
      userPaused: false,
      pauseWaiters: [],
      logSeq: 0,
      currentChapter: null,
      totalChapters: null,
      firstChapter: null,
      lastChapter: null,
      currentPage: 0,
      skipped: 0,
      locked: 0,
      pages: 0,
      log: [],
      chapters: {},
      tmpDir: null,
      error: null,
      pdfPath: null,
      cbzPath: null,
      createdAt,
      finishedAt: null,
      ...initial,
    };
    job.log = (job.log || []).map((entry) => {
      if (entry && typeof entry.message === "string") {
        job.logSeq = Math.max(job.logSeq, Number(entry.id) || 0);
        return entry;
      }
      return { id: ++job.logSeq, at: createdAt, message: String(entry) };
    });
    this.jobs.set(job.id, job);
    this._persist(job);
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  snapshot(id) {
    const j = this.get(id);
    if (!j) return null;
    const completed = getCompletedChapterCount(j);
    const runningExportable =
      j.status === "running" && !j.tempCleaned && completed > 0;
    const downloads = {};
    if (j.status === "complete") {
      if (j.pdfPath) downloads.pdf = `/api/jobs/${j.id}/download?format=pdf`;
      if (artifactPath(j, "cbz")) downloads.cbz = `/api/jobs/${j.id}/download?format=cbz`;
    } else if (runningExportable) {
      downloads.pdf = `/api/jobs/${j.id}/download?format=pdf`;
      downloads.cbz = `/api/jobs/${j.id}/download?format=cbz`;
    }
    return {
      id: j.id,
      status: j.status,
      phase: j.phase,
      resumable: Boolean(j.resumable && getResumableKeys(j).length > 0),
      seriesKey: j.seriesKey || null,
      paused: Boolean(j.userPaused || j.downloadPaused),
      userPaused: Boolean(j.userPaused),
      downloadPaused: Boolean(j.downloadPaused),
      tempCleaned: Boolean(j.tempCleaned),
      settings: j.settings,
      speed: j.speed || null,
      throttle: globalThrottle.snapshot(),
      title: j.title,
      slug: j.slug,
      kind: j.kind,
      medium: j.medium,
      startChapter: j.startChapter,
      endChapter: j.endChapter,
      currentChapter: j.currentChapter,
      totalChapters: j.totalChapters,
      firstChapter: j.firstChapter,
      lastChapter: j.lastChapter,
      hasPrologue: j.hasPrologue,
      currentPage: j.currentPage,
      pages: j.pages,
      skipped: j.skipped,
      locked: j.locked,
      completedChapters: completed,
      retryable: getRetryable(j),
      chapters: Object.entries(j.chapters)
        .map(([ch, data]) => ({ chapter: Number(ch), ...data }))
        .sort((a, b) => a.chapter - b.chapter),
      log: j.log.slice(-100),
      lastLogId: j.logSeq,
      error: j.error,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
      downloads,
      downloadUrl: downloads.pdf ? `/api/jobs/${j.id}/download` : null,
      partialDownload: runningExportable,
    };
  }

  pushLog(job, message) {
    if (job.log.length > 1000) job.log.shift();
    const entry = { id: ++job.logSeq, at: Date.now(), message: String(message) };
    job.log.push(entry);
    this._emit(job);
  }

  setPhase(job, phase) {
    if (job.phase === phase) return;
    job.phase = phase;
    this._persist(job);
    this._emit(job, true);
  }

  markQueued(job) {
    job.status = "queued";
    job.phase = "queued";
    this._persist(job);
    this._emit(job, true);
  }

  subscribe(jobId, listener) {
    if (!this.listeners.has(jobId)) this.listeners.set(jobId, new Set());
    this.listeners.get(jobId).add(listener);
    return () => {
      const listeners = this.listeners.get(jobId);
      if (!listeners) return;
      listeners.delete(listener);
      if (listeners.size === 0) this.listeners.delete(jobId);
    };
  }

  _emit(job, force = false) {
    const listeners = this.listeners.get(job.id);
    if (!listeners || listeners.size === 0) return;
    const now = Date.now();
    if (!force && now - (job._lastEmitAt || 0) < 120) return;
    job._lastEmitAt = now;
    const snapshot = this.snapshot(job.id);
    for (const listener of listeners) {
      try {
        listener(snapshot);
      } catch {}
    }
  }

  setDownloadPause(job, paused) {
    job.downloadPaused = Boolean(paused);
    if (!job.downloadPaused && !job.userPaused) this._wakeWaiters(job);
    this._persist(job);
    this._emit(job, true);
  }

  setUserPause(job, paused) {
    job.userPaused = Boolean(paused);
    if (!job.userPaused && !job.downloadPaused) this._wakeWaiters(job);
    this._persist(job);
    this._emit(job, true);
  }

  _wakeWaiters(job) {
    const waiters = job.pauseWaiters.splice(0);
    for (const resolve of waiters) resolve();
  }

  waitForResume(job) {
    if (!job.downloadPaused && !job.userPaused) return Promise.resolve();
    return new Promise((resolve) => {
      (job.pauseWaiters ||= []).push(resolve);
    });
  }

  setChapter(job, ch, patch) {
    if (!job.chapters[ch]) {
      job.chapters[ch] = { status: "pending", pagesDone: 0, pagesTotal: 0, reason: null };
    }
    Object.assign(job.chapters[ch], patch);
    this._persist(job);
    this._emit(job);
  }

  /// Chapters that are safe to retry.
  findRetryable(job, chapterKeys = null) {
    return getRetryable(job, chapterKeys);
  }

  finish(job, status, { error, pdfPath, cbzPath, resumable = false } = {}) {
    job.status = status;
    job.error = error || null;
    if (pdfPath) job.pdfPath = pdfPath;
    if (cbzPath) job.cbzPath = cbzPath;
    job.resumable = Boolean(resumable && status === "failed");
    job.finishedAt = Date.now();
    this._persist(job);
    this._emit(job, true);
  }

  _sweep() {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      const done = job.status === "complete" || job.status === "failed";
      if (done && now - job.finishedAt > config.JOB_TTL_MS) {
        removeJobArtifacts(job);
        if (job.uploadedCoverPath) this.persistence.deleteCoverUpload(job.uploadedCoverPath);
        this.persistence.deleteJob(job.id);
        this.jobs.delete(job.id);
      }
      // Abandoned queued/running jobs (e.g. crashed process mid-run)
      if (!done && now - job.createdAt > config.JOB_TTL_MS * 2) {
        job.status = "failed";
        job.phase = "interrupted";
        job.error = "Interrupted before completion; resume available.";
        job.finishedAt = now;
        job.resumable = true;
        this._persist(job);
      }
    }
  }
}

module.exports = { JobStore, removeJobArtifacts, clearJobTempFiles, artifactPath };

function getCompletedChapterCount(job) {
  return Object.values(job.chapters || {}).filter((data) => data.status === "done").length;
}

function artifactPath(job, format) {
  if (format !== "cbz") return job.pdfPath || null;
  if (job.cbzPath) return job.cbzPath;
  if (job.pdfPath) {
    const inferred = job.pdfPath.replace(/\.pdf$/i, ".cbz");
    if (fs.existsSync(inferred)) return inferred;
  }
  return null;
}

function removeJobArtifacts(job) {
  if (job.tmpDir) {
    try {
      fs.rmSync(job.tmpDir, { recursive: true, force: true });
    } catch {}
  }
  for (const partialPath of job.partialPaths || []) {
    try {
      fs.rmSync(partialPath, { force: true });
    } catch {}
  }
  const artifacts = [job.pdfPath, job.cbzPath];
  if (job.pdfPath && !job.cbzPath) {
    artifacts.push(job.pdfPath.replace(/\.pdf$/i, ".cbz"));
  }
  for (const artifact of artifacts) {
    if (!artifact) continue;
    try {
      fs.rmSync(artifact, { force: true });
    } catch {}
  }
}

function clearJobTempFiles(job) {
  if (!job.tmpDir || !fs.existsSync(job.tmpDir)) return;
  const artifacts = [job.pdfPath, job.cbzPath];
  if (job.pdfPath && !job.cbzPath) {
    artifacts.push(job.pdfPath.replace(/\.pdf$/i, ".cbz"));
  }
  const keep = new Set(artifacts.filter(Boolean).map((artifact) => path.resolve(artifact)));
  for (const entry of fs.readdirSync(job.tmpDir)) {
    const fullPath = path.join(job.tmpDir, entry);
    if (keep.has(path.resolve(fullPath))) continue;
    try {
      fs.rmSync(fullPath, { recursive: true, force: true });
    } catch {}
  }
  job.partialPaths = [];
  job.tempCleaned = true;
}

function getResumableKeys(job) {
  return Object.entries(job.chapters || {})
    .filter(([, data]) => data.status !== "done" && !/locked\/premium/.test(data.reason || ""))
    .map(([key]) => Number(key))
    .sort((a, b) => a - b);
}

function getRetryable(job, chapterKeys = null) {
  const allowed = chapterKeys && new Set(chapterKeys.map(Number));
  return Object.entries(job.chapters || {})
    .filter(([, d]) => d.status === "skipped" && !/locked\/premium/.test(d.reason || ""))
    .filter(([ch]) => !allowed || allowed.has(Number(ch)))
    .map(([ch]) => Number(ch))
    .sort((a, b) => a - b);
}
