"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { chapterDisplayLabel } = require("../src/util");

test("chapterDisplayLabel adds Chapter once to plain numbers", () => {
  assert.strictEqual(chapterDisplayLabel(1), "Chapter 1");
  assert.strictEqual(chapterDisplayLabel("12"), "Chapter 12");
  assert.strictEqual(chapterDisplayLabel("40 (40 + 40.5)"), "Chapter 40 (40 + 40.5)");
});

test("chapterDisplayLabel preserves existing chapter and prologue labels", () => {
  assert.strictEqual(chapterDisplayLabel("Chapter 1"), "Chapter 1");
  assert.strictEqual(chapterDisplayLabel("Prologue"), "Prologue");
  assert.strictEqual(chapterDisplayLabel(0), "Prologue");
  assert.strictEqual(chapterDisplayLabel("0"), "Prologue");
  assert.strictEqual(chapterDisplayLabel("Chapter 0"), "Prologue");
  assert.strictEqual(chapterDisplayLabel(null), "Chapter");
});
