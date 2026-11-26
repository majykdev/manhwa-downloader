"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { JobStore } = require("../src/jobs/store");

function makeArtifacts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asura-dl-test-"));
  const pdfPath = path.join(dir, "book.pdf");
  fs.writeFileSync(path.join(dir, "001.img"), "image");
  fs.writeFileSync(pdfPath, "pdf");
  return { dir, pdfPath };
}

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
