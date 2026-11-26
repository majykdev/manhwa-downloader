"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

const { buildPdf } = require("../src/jobs/runner");

function countPdfPages(pdfPath) {
  const raw = fs.readFileSync(pdfPath).toString("latin1");
  return (raw.match(/\/Type\s*\/Page\b/g) || []).filter((m) => !m.includes("Pages")).length;
}

function pageSizes(raw) {
  return (raw.match(/\/MediaBox\s*\[[^\]]+\]/g) || []).map((match) =>
    match
      .slice(match.indexOf("[") + 1, -1)
      .trim()
      .split(/\s+/)
      .slice(2)
      .map(Number),
  );
}

test("buildPdf includes a saved cover as the first page and counts it", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "asura-runner-test-"));
  const out = path.join(dir, "out.pdf");
  const chapterDir = path.join(dir, "chap-1");
  fs.mkdirSync(chapterDir, { recursive: true });

  const page = await sharp({
    create: { width: 200, height: 300, channels: 3, background: "rgb(20, 40, 60)" },
  })
    .jpeg()
    .toBuffer();
  const cover = await sharp({
    create: { width: 300, height: 450, channels: 3, background: "rgb(90, 30, 60)" },
  })
    .jpeg()
    .toBuffer();

  fs.writeFileSync(path.join(chapterDir, "000.img"), page);
  fs.writeFileSync(
    path.join(chapterDir, "meta.json"),
    JSON.stringify([{ file: "000.img", width: 200, height: 300 }]),
  );
  fs.writeFileSync(path.join(dir, "cover.img"), cover);
  fs.writeFileSync(path.join(dir, "cover.meta.json"), JSON.stringify({ width: 300, height: 450 }));

  const job = {
    title: "Test Comic",
    kind: "asura",
    tmpDir: dir,
    chapters: { 1: { label: "1", status: "done" } },
    pages: 0,
    currentPage: 0,
  };

  const result = await buildPdf(null, job, out);
  assert.strictEqual(result.pages, 2);
  assert.strictEqual(job.pages, 2);
  assert.strictEqual(countPdfPages(out), 4);
  const sizes = pageSizes(fs.readFileSync(out).toString("latin1"));
  assert.ok(sizes.some((size) => size[0] === 390 && size[1] === 585));
  assert.ok(sizes.some((size) => size[0] === 390 && size[1] === 552));
});
