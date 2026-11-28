"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { createPersistence } = require("../src/jobs/persistence");
const { JobStore } = require("../src/jobs/store");

function makePersistence(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "manhwa-persistence-test-"));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return createPersistence(dir);
}

test("persistence saves and reloads jobs without runtime waiters", (t) => {
  const persistence = makePersistence(t);
  persistence.saveJob({
    id: "job1",
    status: "complete",
    chapters: { 1: { status: "done" } },
    pauseWaiters: [() => {}],
  });

  const loaded = persistence.loadJobs();
  assert.strictEqual(loaded.length, 1);
  assert.strictEqual(loaded[0].id, "job1");
  assert.deepStrictEqual(loaded[0].pauseWaiters, []);
  assert.deepStrictEqual(loaded[0].partialPaths, []);
});

test("JobStore restores interrupted jobs as resumable", (t) => {
  const persistence = makePersistence(t);
  persistence.saveJob({
    id: "interrupted",
    status: "running",
    phase: "scraping",
    chapters: { 1: { status: "done" }, 2: { status: "scraping" } },
    log: [],
    createdAt: Date.now(),
  });

  const store = new JobStore({ persistence, restore: true, persist: false });
  t.after(() => clearInterval(store._ticker));
  const job = store.get("interrupted");
  assert.strictEqual(job.status, "failed");
  assert.strictEqual(job.phase, "interrupted");
  assert.strictEqual(job.resumable, true);
  assert.match(job.error, /resume available/);
});

test("persistence saves and deletes uploaded covers", (t) => {
  const persistence = makePersistence(t);
  const token = persistence.saveCoverUpload(Buffer.from("cover-bytes"));

  assert.match(token, /^[a-f0-9]{32}$/);
  assert.strictEqual(fs.readFileSync(persistence.getCoverPath(token), "utf8"), "cover-bytes");

  persistence.deleteCoverUpload(token);
  assert.strictEqual(persistence.getCoverPath(token), null);
});
