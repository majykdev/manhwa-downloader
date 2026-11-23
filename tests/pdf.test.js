"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

const { PdfBuilder } = require("../src/pdf/builder");

async function makeWebp(width, height, color) {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: color,
    },
  })
    .webp()
    .toBuffer();
}

function countPdfPages(pdfPath) {
  const raw = fs.readFileSync(pdfPath).toString("latin1");
  const matches = raw.match(/\/Type\s*\/Page\b/g) || [];
  return matches.filter((m) => !m.includes("Pages")).length;
}

test("PdfBuilder writes a valid PDF with image pages + spacer pages", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asura-pdf-test-"));
  const out = path.join(tmp, "out.pdf");

  const a = await makeWebp(200, 300, "rgb(200, 40, 40)");
  const b = await makeWebp(400, 250, "rgb(40, 120, 200)");

  const builder = new PdfBuilder(out);
  // Chapter 0: 2 images
  await builder.addImage(a);
  await builder.addImage(b);
  // spacer for chapter 1
  builder.addSpacer(1);
  // Chapter 1: 2 images
  await builder.addImage(b);
  await builder.addImage(a);
  await builder.finish();

  const header = fs.readFileSync(out).subarray(0, 5).toString();
  assert.strictEqual(header, "%PDF-");
  assert.strictEqual(builder.pageCount, 5);
  assert.strictEqual(countPdfPages(out), 5);
  assert.ok(fs.statSync(out).size > 1000);
});

test("PdfBuilder handles a single chapter with no spacer", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asura-pdf-test2-"));
  const out = path.join(tmp, "out.pdf");
  const img = await makeWebp(100, 100, "rgb(10, 200, 90)");

  const builder = new PdfBuilder(out);
  await builder.addImage(img);
  await builder.finish();

  assert.strictEqual(builder.pageCount, 1);
  assert.strictEqual(countPdfPages(out), 1);
});
