"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const {
  normalizeChapterRange,
  logicalChapterNumber,
  inChapterRange,
  filterByChapterRange,
} = require("../src/chapterRange");

test("normalizeChapterRange accepts blank bounds and validates whole numbers", () => {
  assert.deepStrictEqual(normalizeChapterRange({}), {
    startChapter: null,
    endChapter: null,
  });
  assert.deepStrictEqual(normalizeChapterRange({ startChapter: "37", endChapter: "" }), {
    startChapter: 37,
    endChapter: null,
  });
  assert.throws(() => normalizeChapterRange({ startChapter: 1.5 }), /whole chapter/);
  assert.throws(() => normalizeChapterRange({ startChapter: -1 }), /greater/);
  assert.throws(() => normalizeChapterRange({ startChapter: 10, endChapter: 5 }), /greater than end/);
});

test("logicalChapterNumber treats decimal parts as their base chapter", () => {
  assert.strictEqual(logicalChapterNumber(37), 37);
  assert.strictEqual(logicalChapterNumber(37.2), 37);
  assert.strictEqual(logicalChapterNumber("40.5"), 40);
  assert.strictEqual(logicalChapterNumber("nope"), null);
});

test("inChapterRange can compare by base chapter", () => {
  assert.strictEqual(inChapterRange(37.2, { startChapter: 37, endChapter: 37 }), false);
  assert.strictEqual(
    inChapterRange(37.2, { startChapter: 37, endChapter: 37 }, { logical: true }),
    true,
  );
  assert.strictEqual(inChapterRange(38, { endChapter: 37 }, { logical: true }), false);
});

test("filterByChapterRange keeps unbounded chapters and caps oversized ends", () => {
  const items = [1, 36, 37, 37.1, 37.2, 38, 100];
  assert.deepStrictEqual(filterByChapterRange(items, (n) => n, {}), items);
  assert.deepStrictEqual(
    filterByChapterRange(items, (n) => n, { startChapter: 37, endChapter: 500 }),
    [37, 38, 100],
  );
  assert.deepStrictEqual(
    filterByChapterRange(items, (n) => n, { startChapter: 37, endChapter: 37 }, { logical: true }),
    [37, 37.1, 37.2],
  );
});
