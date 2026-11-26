"use strict";

const crypto = require("crypto");
const fs = require("fs");
const config = require("../config");

/**
 * In-memory job registry. Suitable for a single server instance
 * (Render/Railway/Fly web service). Swap for Redis if scaling to
 * multiple instances.
 */
class JobStore {
  constructor() {
    this.jobs = new Map();
    this.listeners = new Map();
    this._ticker = setInterval(() => this._sweep(), 60_000);
    this._ticker.unref?.();
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
      settings: null,
      speed: null,
      startChapter: null,
      endChapter: null,
      partialPaths: [],
      downloadPaused: false,
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
    return job;
  }

  get(id) {
    return this.jobs.get(id) || null;
  }

  snapshot(id) {
    const j = this.get(id);
    if (!j) return null;
    return {
      id: j.id,
      status: j.status,
      phase: j.phase,
      settings: j.settings,
      speed: j.speed || null,
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
      completedChapters: getCompletedChapterCount(j),
      retryable: getRetryable(j),
      chapters: Object.entries(j.chapters)
        .map(([ch, data]) => ({ chapter: Number(ch), ...data }))
        .sort((a, b) => a.chapter - b.chapter),
      log: j.log.slice(-100),
      lastLogId: j.logSeq,
      error: j.error,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
      downloadUrl:
        j.status === "complete" || (j.status === "running" && getCompletedChapterCount(j) > 0)
          ? `/api/jobs/${j.id}/download`
          : null,
      partialDownload:
        j.status === "running" && getCompletedChapterCount(j) > 0,
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
    if (!paused) {
      job.downloadPaused = false;
      const waiters = job.pauseWaiters.splice(0);
      for (const resolve of waiters) resolve();
      return;
    }
    job.downloadPaused = true;
  }

  waitForResume(job) {
    if (!job.downloadPaused) return Promise.resolve();
    return new Promise((resolve) => {
      (job.pauseWaiters ||= []).push(resolve);
    });
  }

  setChapter(job, ch, patch) {
    if (!job.chapters[ch]) {
      job.chapters[ch] = { status: "pending", pagesDone: 0, pagesTotal: 0, reason: null };
    }
    Object.assign(job.chapters[ch], patch);
    this._emit(job);
  }

  /// Chapters that failed only on image download (safe to retry).
  findRetryable(job) {
    return getRetryable(job);
  }

  finish(job, status, { error, pdfPath } = {}) {
    job.status = status;
    job.error = error || null;
    if (pdfPath) job.pdfPath = pdfPath;
    job.finishedAt = Date.now();
    this._emit(job, true);
  }

  _sweep() {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      const done = job.status === "complete" || job.status === "failed";
      if (done && now - job.finishedAt > config.JOB_TTL_MS) {
        removeJobArtifacts(job);
        this.jobs.delete(job.id);
      }
      // Abandoned queued/running jobs (e.g. crashed process mid-run)
      if (!done && now - job.createdAt > config.JOB_TTL_MS * 2) {
        removeJobArtifacts(job);
        job.status = "failed";
        job.error = "Timed out (server restarted?).";
        job.finishedAt = now;
      }
    }
  }
}

module.exports = { JobStore, removeJobArtifacts };

function getCompletedChapterCount(job) {
  return Object.values(job.chapters || {}).filter((data) => data.status === "done").length;
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
  if (job.pdfPath) {
    try {
      fs.rmSync(job.pdfPath, { force: true });
    } catch {}
  }
}

function getRetryable(job) {
  return Object.entries(job.chapters)
    .filter(([_ch, d]) => d.status === "skipped" && /image download failed/.test(d.reason || ""))
    .map(([ch]) => Number(ch))
    .sort((a, b) => a - b);
}
