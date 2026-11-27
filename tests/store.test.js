"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { JobStore, clearJobTempFiles } = require("../src/jobs/store");

function makeArtifacts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asura-dl-test-"));
  const pdfPath = path.join(dir, "book.pdf");
  fs.writeFileSync(path.join(dir, "001.img"), "image");
  fs.writeFileSync(pdfPath, "pdf");
  return { dir, pdfPath };
}

test("user pause exposes a paused snapshot and blocks waiters until resumed", async () => {
  const store = new JobStore();
  const job = store.create({ status: "running", phase: "scraping" });

  assert.strictEqual(store.snapshot(job.id).paused, false);
  store.setUserPause(job, true);
  assert.strictEqual(store.snapshot(job.id).paused, true);
  assert.strictEqual(store.snapshot(job.id).userPaused, true);

  let resumed = false;
  const waiter = store.waitForResume(job).then(() => {
    resumed = true;
  });
  await Promise.resolve();
  assert.strictEqual(resumed, false);

  store.setUserPause(job, false);
  await waiter;
  assert.strictEqual(resumed, true);
  assert.strictEqual(store.snapshot(job.id).paused, false);
});

test("clearJobTempFiles removes temp images but keeps the final PDF", (t) => {
  const { dir, pdfPath } = makeArtifacts();
  const partialPath = path.join(dir, "partial-1.pdf");
  fs.writeFileSync(partialPath, "partial");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = new JobStore();
  const job = store.create({ tmpDir: dir, pdfPath, partialPaths: [partialPath] });

  clearJobTempFiles(job);

  assert.strictEqual(fs.existsSync(pdfPath), true);
  assert.strictEqual(fs.existsSync(path.join(dir, "001.img")), false);
  assert.strictEqual(fs.existsSync(partialPath), false);
  assert.deepStrictEqual(job.partialPaths, []);
  assert.strictEqual(job.tempCleaned, true);
});

test("create normalizes initial log strings and exposes speed snapshots", () => {
  const store = new JobStore();
  const speed = { concurrency: 4, delayMs: 400, auto: true };
  const job = store.create({
    log: ["Selected 3 chapters."],
    speed,
  });

  const snap = store.snapshot(job.id);
  assert.strictEqual(snap.log.length, 1);
  assert.strictEqual(typeof snap.log[0], "object");
  assert.strictEqual(snap.log[0].message, "Selected 3 chapters.");
  assert.strictEqual(snap.log[0].id, 1);
  assert.strictEqual(snap.lastLogId, 1);
  assert.deepStrictEqual(snap.speed, speed);

  store.setPhase(job, "done");
  assert.strictEqual(store.snapshot(job.id).phase, "done");
});

test("sweep deletes artifacts and the entry of an expired finished job", (t) => {
  const { dir, pdfPath } = makeArtifacts();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = new JobStore();
  const job = store.create({
    status: "complete",
    tmpDir: dir,
    pdfPath,
    finishedAt: Date.now() - 7_200_000,
  });

  store._sweep();

  assert.strictEqual(store.get(job.id), null);
  assert.strictEqual(fs.existsSync(dir), false);
  assert.strictEqual(fs.existsSync(pdfPath), false);
});

test("sweep deletes artifacts when a stale running job is marked failed", (t) => {
  const { dir, pdfPath } = makeArtifacts();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));

  const store = new JobStore();
  const job = store.create({
    status: "running",
    tmpDir: dir,
    pdfPath,
    createdAt: Date.now() - 14_400_000,
  });

  store._sweep();

  const failed = store.get(job.id);
  assert.strictEqual(failed.status, "failed");
  assert.match(failed.error, /Timed out/);
  assert.strictEqual(fs.existsSync(dir), false);
  assert.strictEqual(fs.existsSync(pdfPath), false);
});
