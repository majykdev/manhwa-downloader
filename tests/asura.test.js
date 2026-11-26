"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { resolveChapterBounds } = require("../src/scraper/asura");

test("chapter bounds use actual 1-based links instead of numberOfEpisodes - 1", () => {
  const info = {
    numberOfEpisodes: 95,
    chapterNumbers: Array.from({ length: 95 }, (_, i) => i + 1),
  };
  assert.deepStrictEqual(resolveChapterBounds(info, null), {
    firstChapter: 1,
    lastChapter: 95,
  });
});

test("chapter 0 is excluded from the count but chapter 1 is the first numbered chapter", () => {
  const info = {
    numberOfEpisodes: 186,
    chapterNumbers: Array.from({ length: 186 }, (_, i) => i),
  };
  assert.deepStrictEqual(resolveChapterBounds(info, null), {
    firstChapter: 1,
    lastChapter: 185,
  });
});

test("an explicit start chapter overrides discovery, but chapter 0 never does", () => {
  const info = {
    numberOfEpisodes: 95,
    chapterNumbers: Array.from({ length: 95 }, (_, i) => i + 1),
  };
  assert.deepStrictEqual(resolveChapterBounds(info, 5), {
    firstChapter: 5,
    lastChapter: 95,
  });
  assert.deepStrictEqual(resolveChapterBounds(info, 0), {
    firstChapter: 1,
    lastChapter: 95,
  });
});

test("chapter count is used when the series page has no chapter links", () => {
  assert.deepStrictEqual(
    resolveChapterBounds({ numberOfEpisodes: 95, chapterNumbers: [] }, null),
    { firstChapter: 1, lastChapter: 94 },
  );
  assert.deepStrictEqual(
    resolveChapterBounds({ numberOfEpisodes: null, chapterNumbers: [] }, null),
    { firstChapter: 1, lastChapter: null },
  );
});
