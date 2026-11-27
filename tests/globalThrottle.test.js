"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const {
  GlobalThrottle,
  normalizeProfile,
} = require("../src/jobs/globalThrottle");

async function waitForCount(values, count) {
  const started = Date.now();
  while (values.length < count && Date.now() - started < 2000) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function drainReleases(releases, totalTasks, completed) {
  const started = Date.now();
  while (completed.count < totalTasks && Date.now() - started < 2000) {
    await waitForCount(releases, 1);
    releases.splice(0).forEach((resolve) => resolve());
  }
}

test("global throttle defaults to balanced and normalizes profiles", () => {
  assert.strictEqual(normalizeProfile(), "balanced");
  assert.strictEqual(normalizeProfile("nope"), "balanced");
  assert.strictEqual(normalizeProfile("SAFE"), "safe");

  const throttle = new GlobalThrottle("balanced", { delays: false });
  const snap = throttle.snapshot();
  assert.strictEqual(snap.profile, "balanced");
  assert.strictEqual(snap.requestedConcurrency, 2);
  assert.strictEqual(snap.requestedImageConcurrency, 4);
  assert.strictEqual(snap.pageDelayMs, 350);
});

test("page requests share one app-wide cap", async () => {
  const throttle = new GlobalThrottle("balanced", { delays: false });
  let active = 0;
  let maxActive = 0;
  const completed = { count: 0 };
  const releases = [];

  const tasks = Array.from({ length: 5 }, (_, i) =>
    throttle.run("page", `https://a.example/chapter/${i}`, async () => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => releases.push(resolve));
      active -= 1;
      completed.count += 1;
      return i;
    }),
  );

  await waitForCount(releases, 2);
  assert.strictEqual(active, 2);
  assert.strictEqual(maxActive, 2);
  await drainReleases(releases, 5, completed);
  await Promise.all(tasks);
  assert.strictEqual(maxActive, 2);
});

test("image buckets are isolated per host", async () => {
  const throttle = new GlobalThrottle("balanced", { delays: false });
  let activeA = 0;
  let activeB = 0;
  let maxA = 0;
  let maxB = 0;
  const completed = { count: 0 };
  const releases = [];

  const runImage = (host, key) =>
    throttle.run("image", `https://${host}/${key}`, async () => {
      if (host === "a.example") {
        activeA += 1;
        maxA = Math.max(maxA, activeA);
      } else {
        activeB += 1;
        maxB = Math.max(maxB, activeB);
      }
      await new Promise((resolve) => releases.push(resolve));
      if (host === "a.example") activeA -= 1;
      else activeB -= 1;
      completed.count += 1;
    });

  const tasks = [
    ...Array.from({ length: 6 }, (_, i) => runImage("a.example", i)),
    ...Array.from({ length: 2 }, (_, i) => runImage("b.example", i)),
  ];

  await waitForCount(releases, 6);
  assert.strictEqual(activeA, 4);
  assert.strictEqual(activeB, 2);
  assert.strictEqual(maxA, 4);
  assert.strictEqual(maxB, 2);
  await drainReleases(releases, 8, completed);
  await Promise.all(tasks);
});

test("a rate limit lowers shared budgets and applies a global cooldown", async () => {
  const throttle = new GlobalThrottle("balanced", { delays: false });
  throttle.reportRateLimit();

  const snap = throttle.snapshot();
  assert.strictEqual(snap.rateLimited, true);
  assert.strictEqual(snap.effectiveConcurrency, 1);
  assert.strictEqual(snap.effectiveImageConcurrency, 2);
  assert.strictEqual(snap.pageDelayMs, 500);
  assert.ok(snap.cooldownRemainingMs > 0);

  throttle.cooldownUntil = Date.now() + 20;
  const started = Date.now();
  await throttle.run("page", "https://a.example/chapter/1", () => "ok");
  assert.ok(Date.now() - started >= 15);
});
