"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const {
  SpeedController,
  DynamicLimiter,
  isRateLimitError,
  normalizeSpeedSettings,
} = require("../src/jobs/speedController");

test("normalizeSpeedSettings clamps invalid choices to defaults", () => {
  assert.deepStrictEqual(normalizeSpeedSettings({ concurrency: "3", delay: "250" }), {
    concurrency: "3",
    delay: "250",
  });
  assert.deepStrictEqual(normalizeSpeedSettings({ concurrency: "99", delay: "x" }), {
    concurrency: "auto",
    delay: "auto",
  });
});

test("auto speed starts at 4 and 400ms, then adapts", () => {
  const speed = new SpeedController({});
  assert.strictEqual(speed.concurrency(), 4);
  assert.strictEqual(speed.delayMs(), 400);
  speed.reportSuccess();
  assert.strictEqual(speed.delayMs(), 400);
  speed.reportSuccess();
  assert.strictEqual(speed.delayMs(), 350);
  for (let i = 0; i < 6; i++) speed.reportSuccess();
  assert.strictEqual(speed.delayMs(), 250);

  const logs = [];
  speed.reportRateLimit((line) => logs.push(line));
  assert.strictEqual(speed.concurrency(), 3);
  assert.strictEqual(speed.delayMs(), 300);
  assert.strictEqual(logs.length, 2);
});

test("manual high concurrency reverts to one on rate limit", () => {
  const speed = new SpeedController({ concurrency: "4", delay: "300" });
  speed.reportRateLimit();
  assert.strictEqual(speed.concurrency(), 1);
  assert.strictEqual(speed.delayMs(), 300);
});

test("isRateLimitError recognizes throttling but not missing chapters", () => {
  assert.strictEqual(isRateLimitError({ status: 429 }), true);
  assert.strictEqual(isRateLimitError({ status: 404 }), false);
  assert.strictEqual(isRateLimitError({ cloudflareBlock: true }), true);
});

test("DynamicLimiter lowers active slots after setMax", async () => {
  const limiter = new DynamicLimiter(3);
  assert.strictEqual(limiter.max, 3);
  limiter.setMax(1);
  assert.strictEqual(limiter.max, 1);
  await limiter.run(() => Promise.resolve());
});
