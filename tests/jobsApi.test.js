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
  const store = new JobStore();
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
