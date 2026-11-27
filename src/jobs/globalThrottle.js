"use strict";

const { DynamicLimiter, isRateLimitError } = require("./speedController");
const { sleep } = require("../util");

const PROFILES = {
  safe: {
    label: "Safe",
    concurrency: 1,
    imageConcurrency: 2,
    pageDelayMs: 400,
    imageDelayMs: 150,
  },
  balanced: {
    label: "Balanced",
    concurrency: 2,
    imageConcurrency: 4,
    pageDelayMs: 350,
    imageDelayMs: 120,
  },
  fast: {
    label: "Fast",
    concurrency: 4,
    imageConcurrency: 4,
    pageDelayMs: 250,
    imageDelayMs: 80,
  },
};

function normalizeProfile(value) {
  const key = String(value ?? "balanced").trim().toLowerCase();
  return PROFILES[key] ? key : "balanced";
}

function hostFromUrl(value) {
  try {
    return new URL(String(value)).hostname.replace(/^www\./, "");
  } catch {
    return "unknown";
  }
}

class GlobalThrottle {
  constructor(profile = "balanced", options = {}) {
    this.delaysEnabled = options.delays !== false;
    this.listeners = new Set();
    this.successes = 0;
    this.penalty = 0;
    this.cooldownUntil = 0;
    this.hosts = new Map();
    this.jobDelays = new Map();
    this.pageLimiter = new DynamicLimiter(PROFILES.balanced.concurrency);
    this.imageLimiter = new DynamicLimiter(PROFILES.balanced.imageConcurrency * 2);
    this.setProfile(profile, false);
  }

  setProfile(profile, emit = true) {
    this.profile = normalizeProfile(profile);
    this._applyLimits();
    if (emit) this._emit();
  }

  setJobDelay(id, ms) {
    this.jobDelays.set(String(id), Math.max(0, Number(ms) || 0));
    this._emit();
  }

  clearJobDelay(id) {
    this.jobDelays.delete(String(id));
    this._emit();
  }

  snapshot() {
    const base = PROFILES[this.profile];
    return {
      profile: this.profile,
      label: base.label,
      requestedConcurrency: base.concurrency,
      requestedImageConcurrency: base.imageConcurrency,
      effectiveConcurrency: this._pageLimit(),
      effectiveImageConcurrency: this._imageLimit(),
      pageDelayMs: this._pageDelay(),
      imageDelayMs: this._imageDelay(),
      activePages: this.pageLimiter.active,
      queuedPages: this.pageLimiter.waiters.length,
      activeImages: this.imageLimiter.active,
      queuedImages: this.imageLimiter.waiters.length,
      rateLimited: this.penalty > 0,
      cooldownRemainingMs: Math.max(0, this.cooldownUntil - Date.now()),
    };
  }

  subscribe(listener) {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  async run(kind, url, fn, options = {}) {
    const host = hostFromUrl(url);
    const isImage = kind === "image";
    const bucket = this._bucket(host);
    const limiter = isImage ? bucket.images : bucket.pages;
    const globalLimiter = isImage ? this.imageLimiter : this.pageLimiter;
    await this._waitCooldown();
    await globalLimiter.acquire();
    try {
      await limiter.acquire();
      try {
        await this._waitInterval(kind, bucket, options.minDelayMs);
        const value = await fn();
        this.reportSuccess();
        return value;
      } catch (err) {
        if (isRateLimitError(err)) this.reportRateLimit(host);
        throw err;
      } finally {
        limiter.release();
      }
    } finally {
      globalLimiter.release();
    }
  }

  reportRateLimit() {
    this.successes = 0;
    const wasPenalized = this.penalty > 0;
    this.penalty = Math.min(3, this.penalty + 1);
    this.cooldownUntil = Date.now() + 3000 * this.penalty;
    this._applyLimits();
    this._emit();
    return !wasPenalized;
  }

  reportSuccess() {
    this.successes += 1;
    if (this.successes < 20 || this.penalty === 0) return;
    this.successes = 0;
    this.penalty -= 1;
    this._applyLimits();
    this._emit();
  }

  _pageLimit() {
    const base = PROFILES[this.profile].concurrency;
    return Math.max(1, base - this.penalty);
  }

  _imageLimit() {
    const base = PROFILES[this.profile].imageConcurrency;
    return Math.max(1, base - this.penalty * 2);
  }

  _pageDelay() {
    const jobDelay = this.jobDelays.size ? Math.max(...this.jobDelays.values()) : 0;
    return Math.max(PROFILES[this.profile].pageDelayMs + this.penalty * 150, jobDelay);
  }

  _imageDelay() {
    return PROFILES[this.profile].imageDelayMs + this.penalty * 50;
  }

  _bucket(host) {
    let bucket = this.hosts.get(host);
    if (!bucket) {
      bucket = {
        pages: new DynamicLimiter(this._pageLimit()),
        images: new DynamicLimiter(this._imageLimit()),
        lastPageAt: 0,
        lastImageAt: 0,
      };
      this.hosts.set(host, bucket);
    }
    return bucket;
  }

  _applyLimits() {
    this.pageLimiter.setMax(this._pageLimit());
    this.imageLimiter.setMax(this._imageLimit() * 2);
    for (const bucket of this.hosts.values()) {
      bucket.pages.setMax(this._pageLimit());
      bucket.images.setMax(this._imageLimit());
    }
  }

  async _waitCooldown() {
    while (Date.now() < this.cooldownUntil) {
      await sleep(Math.min(500, Math.max(25, this.cooldownUntil - Date.now())));
    }
  }

  async _waitInterval(kind, bucket, minDelayMs) {
    if (!this.delaysEnabled) return;
    const isImage = kind === "image";
    const configured = isImage ? this._imageDelay() : Math.max(this._pageDelay(), Number(minDelayMs) || 0);
    const key = isImage ? "lastImageAt" : "lastPageAt";
    const elapsed = Date.now() - bucket[key];
    if (elapsed < configured) await sleep(configured - elapsed);
    bucket[key] = Date.now();
  }

  _emit() {
    const snapshot = this.snapshot();
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {}
    }
  }
}

module.exports = {
  PROFILES,
  GlobalThrottle,
  globalThrottle: new GlobalThrottle(),
  normalizeProfile,
  hostFromUrl,
};
