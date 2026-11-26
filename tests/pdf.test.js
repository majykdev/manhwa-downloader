"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sharp = require("sharp");

const { PdfBuilder, printerPageSize } = require("../src/pdf/builder");

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

function pageSizes(builder) {
  return builder.doc._root.data.Pages.data.Kids.map((page) =>
    page.data.MediaBox.slice(2).map(Number),
  );
}

function pdfText(raw) {
  return (raw.match(/<([0-9A-Fa-f]+)>/g) || [])
    .map((chunk) => Buffer.from(chunk.slice(1, -1), "hex").toString("latin1"))
    .join("");
}

test("printerPageSize uses printer-page proportions and fits inside the chapter page", () => {
  const tall = printerPageSize([390, 585]);
  const wide = printerPageSize([390, 244]);
  const tiny = printerPageSize([100, 100]);

  for (const [page, box] of [[tall, [390, 585]], [wide, [390, 244]], [tiny, [100, 100]]]) {
    assert.ok(page[0] <= box[0]);
    assert.ok(page[1] <= box[1]);
    assert.ok(Math.abs(page[0] / page[1] - 1 / Math.SQRT2) < 0.02);
  }
});

test("PdfBuilder writes a title page, clickable TOC, dividers, and image pages", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asura-pdf-test-"));
  const out = path.join(tmp, "out.pdf");

  const a = await makeWebp(200, 300, "rgb(200, 40, 40)");
  const b = await makeWebp(400, 250, "rgb(40, 120, 200)");
  const builder = new PdfBuilder(out, { compress: false });
  const sizeA = await builder.measurePageSize(a);
  const sizeB = await builder.measurePageSize(b);

  const prologueIndex = builder.addSpacer("Prologue", sizeA);
  await builder.addImage(a, sizeA);
  await builder.addImage(b, sizeA);
  const chapterIndex = builder.addSpacer("Chapter 1", sizeB);
  await builder.addImage(b, sizeB);
  await builder.addImage(a, sizeB);
  builder.addTitlePage("Test Comic", [
    { label: "Prologue", pageIndex: prologueIndex },
    { label: "Chapter 1", pageIndex: chapterIndex },
  ]);
  await builder.finish();

  const header = fs.readFileSync(out).subarray(0, 5).toString();
  assert.strictEqual(header, "%PDF-");
  assert.strictEqual(builder.pageCount, 7);
  assert.strictEqual(countPdfPages(out), 7);
  const sizes = pageSizes(builder);
  assert.deepStrictEqual(sizes[0], [390, 844]);
  assert.deepStrictEqual(sizes[1], printerPageSize(sizeA));
  assert.deepStrictEqual(sizes[4], printerPageSize(sizeB));

  const kids = builder.doc._root.data.Pages.data.Kids;
  const annots = kids[0].data.Annots;
  assert.strictEqual(annots.length, 2);
  assert.strictEqual(annots[0].data.A.data.D[0], kids[1]);
  assert.strictEqual(annots[1].data.A.data.D[0], kids[4]);

  const text = pdfText(fs.readFileSync(out).toString("latin1"));
  assert.ok(text.includes("Test Comic"));
  assert.ok(text.includes("Prologue"));
  assert.ok(text.includes("Chapter 1"));
});

test("PdfBuilder keeps each image's natural height by default", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asura-pdf-test2-"));
  const out = path.join(tmp, "out.pdf");
  const a = await makeWebp(200, 300, "rgb(10, 200, 90)");
  const b = await makeWebp(400, 250, "rgb(90, 10, 200)");
  const builder = new PdfBuilder(out);
  const sizeA = await builder.measurePageSize(a);
  const sizeB = await builder.measurePageSize(b);

  await builder.addImage(a, sizeA);
  await builder.addImage(b, sizeB);
  await builder.finish();

  assert.strictEqual(builder.pageCount, 2);
  assert.deepStrictEqual(pageSizes(builder), [
    [390, 585],
    [390, 244],
  ]);
});

test("PdfBuilder normalizes a chapter to the first page size when requested", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asura-pdf-test3-"));
  const out = path.join(tmp, "out.pdf");
  const a = await makeWebp(200, 300, "rgb(20, 40, 200)");
  const b = await makeWebp(400, 250, "rgb(200, 40, 20)");
  const builder = new PdfBuilder(out, {
    chapterPageSizeMode: "first",
    compress: false,
  });
  const sizeA = await builder.measurePageSize(a);

  const index = builder.addSpacer("Chapter 1", sizeA);
  await builder.addImage(a, sizeA);
  await builder.addImage(b, sizeA);
  builder.addTitlePage("Normalized", [
    { label: "Chapter 1", pageIndex: index },
  ]);
  await builder.finish();

  assert.deepStrictEqual(pageSizes(builder), [
    [390, 844],
    printerPageSize(sizeA),
    [390, 585],
    [390, 585],
  ]);
});

test("PdfBuilder paginates the TOC when needed", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "asura-pdf-test4-"));
  const out = path.join(tmp, "out.pdf");
  const builder = new PdfBuilder(out, { compress: false });
  await builder.addImage(await makeWebp(100, 100, "rgb(1, 2, 3)"));

  const entries = Array.from({ length: 150 }, (_, i) => ({
    label: `Chapter ${i + 1}`,
    pageIndex: 0,
  }));
  builder.addTitlePage("Long Comic", entries);
  await builder.finish();

  assert.strictEqual(builder.titlePageCount, 2);
  assert.strictEqual(pageSizes(builder).slice(0, 2).length, 2);
  const text = pdfText(fs.readFileSync(out).toString("latin1"));
  assert.ok(text.includes("Chapter 150"));
});
