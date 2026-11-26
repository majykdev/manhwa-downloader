"use strict";

const DEFAULTS = {
  concurrency: "auto",
  delay: "auto",
};

const CONCURRENCY_CHOICES = new Set(["auto", "1", "2", "3", "4"]);
const DELAY_CHOICES = new Set(["auto", "400", "350", "300", "250"]);
const RATE_LIMIT_STATUSES = new Set([403, 429, 503, 520]);

function normalizeChoice(value, choices, fallback) {
  const normalized = String(value ?? fallback).trim().toLowerCase();
  return choices.has(normalized) ? normalized : fallback;
}

function normalizeSpeedSettings(settings = {}) {
  return {
    concurrency: normalizeChoice(settings.concurrency, CONCURRENCY_CHOICES, DEFAULTS.concurrency),
    delay: normalizeChoice(settings.delay, DELAY_CHOICES, DEFAULTS.delay),
  };
}

function isRateLimitError(err) {
  if (!err) return false;
  const status = err.status ?? err.response?.status;
  if (RATE_LIMIT_STATUSES.has(Number(status))) return true;
  if (err.cloudflareBlock) return true;
  const code = String(err.code || "");
  return (
    code === "ECONNABORTED" ||
    code === "ETIMEDOUT" ||
    /cloudflare|too many requests|rate limit/i.test(String(err.message || ""))
  );
}

class SpeedController {
  constructor(settings = {}) {
    const normalized = normalizeSpeedSettings(settings);
    this.concurrencyChoice = normalized.concurrency;
    this.delayChoice = normalized.delay;
    this.concurrencyValue =
      this.concurrencyChoice === "auto" ? 4 : Number(this.concurrencyChoice);
    this.delayValue = this.delayChoice === "auto" ? 400 : Number(this.delayChoice);
    this.successes = 0;
    this.rateLimited = false;
  }

  concurrency() {
    return this.concurrencyValue;
  }

  delayMs() {
    return this.delayValue;
  }

  reportSuccess() {
    this.successes += 1;
    if (this.delayChoice === "auto" && this.successes % 2 === 0) {
      this.delayValue = Math.max(250, this.delayValue - 50);
    }
  }

  reportRateLimit(onLog = () => {}) {
    this.successes = 0;
    this.rateLimited = true;

    if (this.concurrencyChoice === "auto") {
      const next = Math.max(1, this.concurrencyValue - 1);
      if (next !== this.concurrencyValue) {
        onLog(`Rate limit detected — lowering concurrency to ${next}.`);
        this.concurrencyValue = next;
      }
    } else if (this.concurrencyValue >= 3 && this.concurrencyValue !== 1) {
      onLog("Rate limit detected — reverting to one chapter at a time.");
      this.concurrencyValue = 1;
    }

    if (this.delayChoice === "auto" && this.delayValue < 400) {
      this.delayValue = Math.min(400, this.delayValue + 50);
      onLog(`Rate limit detected — raising chapter delay to ${this.delayValue}ms.`);
    }
  }

  snapshot() {
    return {
      concurrency: this.concurrencyChoice,
      delay: this.delayChoice,
      effectiveConcurrency: this.concurrencyValue,
      effectiveDelayMs: this.delayValue,
      rateLimited: this.rateLimited,
    };
  }
}

class DynamicLimiter {
  constructor(max) {
    this.max = Math.max(1, max);
    this.active = 0;
    this.waiters = [];
  }

  setMax(max) {
    this.max = Math.max(1, max);
    this.drain();
  }

  async run(fn) {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }

  acquire() {
    if (this.active < this.max) {
      this.active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => this.waiters.push(resolve));
  }

  release() {
    this.active -= 1;
    this.drain();
  }

  drain() {
    while (this.active < this.max && this.waiters.length > 0) {
      const resolve = this.waiters.shift();
      this.active += 1;
      resolve();
    }
  }
}

module.exports = {
  SpeedController,
  DynamicLimiter,
  isRateLimitError,
  normalizeSpeedSettings,
};
