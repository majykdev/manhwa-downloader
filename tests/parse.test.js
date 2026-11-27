"use strict";

const { test } = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");

const {
  parseInputUrl,
  parseChapterImages,
  parseNextChapter,
  parseSeriesInfo,
} = require("../src/scraper/parse");

const chapterHtml = fs.readFileSync(
  path.join(__dirname, "fixtures", "chapter-0.html"),
  "utf8",
);
const seriesHtml = fs.readFileSync(
  path.join(__dirname, "fixtures", "series.html"),
  "utf8",
);

test("parseInputUrl accepts a chapter URL", () => {
  const parsed = parseInputUrl(
    "https://asurascans.com/comics/trash-of-the-counts-family-7e1f454a/chapter/0",
  );
  assert.strictEqual(parsed.slug, "trash-of-the-counts-family-7e1f454a");
  assert.strictEqual(parsed.chapter, 0);
  assert.strictEqual(
    parsed.baseUrl,
    "https://asurascans.com/comics/trash-of-the-counts-family-7e1f454a",
  );
});

test("parseInputUrl accepts a series URL (chapter defaults to null)", () => {
  const parsed = parseInputUrl(
    "https://asurascans.com/comics/trash-of-the-counts-family-7e1f454a",
  );
  assert.strictEqual(parsed.slug, "trash-of-the-counts-family-7e1f454a");
  assert.strictEqual(parsed.chapter, null);
});

test("parseInputUrl accepts non-Asura hosts as generic", () => {
  const parsed = parseInputUrl("https://example.com/comics/foo");
  assert.strictEqual(parsed.kind, "generic");
});

test("parseInputUrl auto-detects atsu.moe manga and novel series", () => {
  const manga = parseInputUrl("https://atsu.moe/manga/ehgv");
  assert.strictEqual(manga.kind, "atsu");
  assert.strictEqual(manga.slug, "ehgv");
  assert.strictEqual(manga.medium, "Comic");
  assert.strictEqual(manga.chapterId, null);
  assert.strictEqual(manga.baseUrl, "https://atsu.moe/manga/ehgv");

  const novel = parseInputUrl("https://www.atsu.moe/novel/abc123");
  assert.strictEqual(novel.kind, "atsu");
  assert.strictEqual(novel.medium, "Novel");
  assert.strictEqual(novel.baseUrl, "https://atsu.moe/novel/abc123");
});

test("parseInputUrl auto-detects atsu.moe reader URLs", () => {
  const read = parseInputUrl("https://atsu.moe/read/ehgv/aKF-UT");
  assert.strictEqual(read.kind, "atsu");
  assert.strictEqual(read.slug, "ehgv");
  assert.strictEqual(read.chapterId, "aKF-UT");
  assert.strictEqual(read.medium, "Comic");

  const novel = parseInputUrl("https://atsu.moe/novel/abc123/ch-1");
  assert.strictEqual(novel.kind, "atsu");
  assert.strictEqual(novel.chapterId, "ch-1");
  assert.strictEqual(novel.medium, "Novel");
});

test("parseInputUrl extracts chapter numbers from /ch/ and /chap/ URLs", () => {
  assert.strictEqual(
    parseInputUrl("https://flamescans.org/series/foo/ch/42").chapter,
    42,
  );
  assert.strictEqual(
    parseInputUrl("https://flamescans.org/series/foo/chap/43").chapter,
    43,
  );
});

test("parseInputUrl rejects garbage", () => {
  assert.throws(() => parseInputUrl("not a url"), /valid URL/);
  assert.throws(() => parseInputUrl("https://asurascans.com/whatever"), /comics/);
});

test("parseChapterImages extracts all pages in order from a real chapter page", () => {
  const images = parseChapterImages(chapterHtml);
  assert.strictEqual(images.length, 26);
  assert.ok(
    images.every((u) => u.startsWith("https://cdn.asurascans.com/asura-images/chapters/")),
  );
  assert.ok(images.every((u) => !u.includes("?")));
  assert.ok(images[0].endsWith("/001.webp"));
  assert.ok(images[25].endsWith("/026.webp"));
});

test("parseNextChapter finds the rel=next link", () => {
  const next = parseNextChapter(chapterHtml);
  assert.strictEqual(
    next,
    "/comics/trash-of-the-counts-family-7e1f454a/chapter/1",
  );
});

test("parseSeriesInfo reads numberOfEpisodes + title from a real series page", () => {
  const info = parseSeriesInfo(seriesHtml);
  assert.strictEqual(info.numberOfEpisodes, 186);
  assert.ok(info.title && info.title.includes("Trash of the Count"));
  assert.strictEqual(
    info.coverUrl,
    "https://cdn.asurascans.com/asura-images/covers/trash-of-the-counts-family.b543fa.webp",
  );
  assert.strictEqual(info.chapterNumbers.length, 186);
  assert.ok(info.chapterNumbers.includes(0) && info.chapterNumbers.includes(185));
});
