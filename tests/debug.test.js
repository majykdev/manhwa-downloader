"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const {
  getDebugLog,
  debugChapterDownloaded,
  debugPdfDownloaded,
  debugScrapeComplete,
} = require("../src/debug");

function lastEntry() {
  const entries = getDebugLog();
  return entries[entries.length - 1];
}

test("debugChapterDownloaded records the chapter and provider", () => {
  debugChapterDownloaded("abc123", "Chapter 1", 12, "HiveToons");
  const entry = lastEntry();
  assert.strictEqual(entry.level, "info");
  assert.strictEqual(
    entry.message,
    "Job abc123 downloaded chapter Chapter 1 (HiveToons) — 12 pages",
  );
});

test("debugChapterDownloaded handles prologues without a provider", () => {
  debugChapterDownloaded("abc123", "Prologue", 8);
  assert.strictEqual(
    lastEntry().message,
    "Job abc123 downloaded chapter Prologue — 8 pages",
  );
});

test("debugScrapeComplete records the finished job", () => {
  debugScrapeComplete("abc123", "Test Comic", 24, 3);
  const entry = lastEntry();
  assert.strictEqual(entry.level, "info");
  assert.strictEqual(
    entry.message,
    "Job abc123 scrape complete: Test Comic — 24 pages across 3 chapters",
  );
});

test("debugPdfDownloaded records when the user downloads the PDF", () => {
  debugPdfDownloaded("abc123", "Test Comic", "Test Comic.pdf");
  const entry = lastEntry();
  assert.strictEqual(entry.level, "info");
  assert.strictEqual(
    entry.message,
    "Job abc123 PDF downloaded by user: Test Comic → Test Comic.pdf",
  );
});
