"use strict";

const crypto = require("crypto");
const config = require("../config");

/**
 * In-memory job registry. Suitable for a single server instance
 * (Render/Railway/Fly web service). Swap for Redis if scaling to
 * multiple instances.
 */
class JobStore {
  constructor() {
    this.jobs = new Map();
    this._ticker = setInterval(() => this._sweep(), 60_000);
    this._ticker.unref?.();
  }

  create(initial = {}) {
    const job = {
      id: crypto.randomBytes(8).toString("hex"),
      url: null,
      slug: null,
      title: null,
      kind: "asura",
      chapterUrls: null,
      firstChapterUrl: null,
      status: "queued", // queued | running | complete | failed
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
      createdAt: Date.now(),
      finishedAt: null,
      ...initial,
    };
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
      title: j.title,
      slug: j.slug,
      kind: j.kind,
      currentChapter: j.currentChapter,
      totalChapters: j.totalChapters,
      firstChapter: j.firstChapter,
      lastChapter: j.lastChapter,
      currentPage: j.currentPage,
      pages: j.pages,
      skipped: j.skipped,
      locked: j.locked,
      retryable: getRetryable(j),
      chapters: Object.entries(j.chapters)
        .map(([ch, data]) => ({ chapter: Number(ch), ...data }))
        .sort((a, b) => a.chapter - b.chapter),
      log: j.log.slice(-100),
      error: j.error,
      createdAt: j.createdAt,
      finishedAt: j.finishedAt,
      downloadUrl: j.status === "complete" ? `/api/jobs/${j.id}/download` : null,
    };
  }

  pushLog(job, message) {
    if (job.log.length > 1000) job.log.shift();
    job.log.push(message);
  }

  setChapter(job, ch, patch) {
    if (!job.chapters[ch]) {
      job.chapters[ch] = { status: "pending", pagesDone: 0, pagesTotal: 0, reason: null };
    }
    Object.assign(job.chapters[ch], patch);
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
  }

  _sweep() {
    const now = Date.now();
    for (const job of this.jobs.values()) {
      const done = job.status === "complete" || job.status === "failed";
      if (done && now - job.finishedAt > config.JOB_TTL_MS) {
        this.jobs.delete(job.id);
      }
      // Abandoned queued/running jobs (e.g. crashed process mid-run)
      if (!done && now - job.createdAt > config.JOB_TTL_MS * 2) {
        job.status = "failed";
        job.error = "Timed out (server restarted?).";
        job.finishedAt = now;
      }
    }
  }
}

module.exports = { JobStore };

function getRetryable(job) {
  return Object.entries(job.chapters)
    .filter(([_ch, d]) => d.status === "skipped" && /image download failed/.test(d.reason || ""))
    .map(([ch]) => Number(ch))
    .sort((a, b) => a - b);
}
