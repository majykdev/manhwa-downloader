"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const express = require("express");
const { once } = require("node:events");

const { createApiRouter } = require("../src/routes/api");
const { JobStore } = require("../src/jobs/store");

async function withServer(store, fn) {
  const app = express();
  app.use(express.json());
  app.use("/api", createApiRouter(store));
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    await fn(base);
  } finally {
    server.closeAllConnections?.();
    await new Promise((resolve) => server.close(resolve));
  }
}

test("pause and resume endpoints toggle a running job", async (t) => {
  const store = new JobStore();
  t.after(() => clearInterval(store._ticker));
  const job = store.create({ status: "running", phase: "scraping" });

  await withServer(store, async (base) => {
    const paused = await fetch(`${base}/api/jobs/${job.id}/pause`, { method: "POST" });
    assert.strictEqual(paused.status, 200);
    const pausedBody = await paused.json();
    assert.strictEqual(pausedBody.paused, true);
    assert.strictEqual(pausedBody.userPaused, true);
    assert.strictEqual(pausedBody.throttle?.profile, "balanced");

    let resumedPromise = false;
    const waiter = store.waitForResume(job).then(() => {
      resumedPromise = true;
    });
    await Promise.resolve();
    assert.strictEqual(resumedPromise, false);

    const resumed = await fetch(`${base}/api/jobs/${job.id}/resume`, { method: "POST" });
    assert.strictEqual(resumed.status, 200);
    const resumedBody = await resumed.json();
    assert.strictEqual(resumedBody.paused, false);
    await waiter;
    assert.strictEqual(resumedPromise, true);
  });
});

test("downloading the final PDF cleans temp images but keeps the PDF", async (t) => {
  const store = new JobStore({ persist: false, restore: false });
  t.after(() => clearInterval(store._ticker));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asura-download-test-"));
  const pdfPath = path.join(dir, "book.pdf");
  const imagePath = path.join(dir, "001.img");
  fs.writeFileSync(pdfPath, "pdf");
  fs.writeFileSync(imagePath, "image");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const job = store.create({ status: "complete", title: "Test", tmpDir: dir, pdfPath });

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/jobs/${job.id}/download`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), "pdf");
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  assert.strictEqual(fs.existsSync(pdfPath), true);
  assert.strictEqual(fs.existsSync(imagePath), false);
});

test("downloading the CBZ cleans temp images but keeps PDF and CBZ", async (t) => {
  const store = new JobStore({ persist: false, restore: false });
  t.after(() => clearInterval(store._ticker));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asura-cbz-download-test-"));
  const pdfPath = path.join(dir, "book.pdf");
  const cbzPath = path.join(dir, "book.cbz");
  const imagePath = path.join(dir, "001.img");
  fs.writeFileSync(pdfPath, "pdf");
  fs.writeFileSync(cbzPath, "cbz");
  fs.writeFileSync(imagePath, "image");
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const job = store.create({ status: "complete", title: "Test", tmpDir: dir, pdfPath, cbzPath });

  await withServer(store, async (base) => {
    const res = await fetch(`${base}/api/jobs/${job.id}/download?format=cbz`);
    assert.strictEqual(res.status, 200);
    assert.strictEqual(await res.text(), "cbz");
    await new Promise((resolve) => setTimeout(resolve, 50));
  });

  assert.strictEqual(fs.existsSync(pdfPath), true);
  assert.strictEqual(fs.existsSync(cbzPath), true);
  assert.strictEqual(fs.existsSync(imagePath), false);
});

test("continue rejects jobs without saved progress or remaining chapters", async (t) => {
  const store = new JobStore({ persist: false, restore: false });
  t.after(() => clearInterval(store._ticker));
  const plain = store.create({ status: "failed" });
  const finished = store.create({
    status: "failed",
    resumable: true,
    chapters: { 1: { status: "done" }, 2: { status: "skipped", reason: "locked/premium" } },
  });

  await withServer(store, async (base) => {
    const noProgress = await fetch(`${base}/api/jobs/${plain.id}/continue`, { method: "POST" });
    assert.strictEqual(noProgress.status, 409);
    assert.match((await noProgress.json()).error, /saved progress/);

    const noWork = await fetch(`${base}/api/jobs/${finished.id}/continue`, { method: "POST" });
    assert.strictEqual(noWork.status, 409);
    assert.match((await noWork.json()).error, /remaining work/);
  });
});

test("retry validates chapter keys and rejects chapters that cannot be retried", async (t) => {
  const store = new JobStore({ persist: false, restore: false });
  t.after(() => clearInterval(store._ticker));
  const running = store.create({ status: "running" });
  const locked = store.create({
    status: "complete",
    chapters: { 1: { status: "skipped", reason: "locked/premium" } },
  });

  await withServer(store, async (base) => {
    const notFinished = await fetch(`${base}/api/jobs/${running.id}/retry`, { method: "POST" });
    assert.strictEqual(notFinished.status, 409);
    assert.match((await notFinished.json()).error, /finished yet/);

    const invalidKeys = await fetch(`${base}/api/jobs/${locked.id}/retry`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chapterKeys: "1" }),
    });
    assert.strictEqual(invalidKeys.status, 400);
    assert.match((await invalidKeys.json()).error, /list/);

    const noRetryable = await fetch(`${base}/api/jobs/${locked.id}/retry`, { method: "POST" });
    assert.strictEqual(noRetryable.status, 409);
    assert.match((await noRetryable.json()).error, /No retryable chapters/);
  });
});
