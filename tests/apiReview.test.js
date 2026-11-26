"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const {
  publicDiscovery,
  makeAsuraPreview,
  makeGenericPreview,
  normalizeChapterEdits,
  normalizeExcludedPartKeys,
  buildPreviewJobSpec,
  applyEditsToAtsuSpec,
} = require("../src/routes/api");

test("publicDiscovery exposes a common chapter list with cover and keys", () => {
  const discovery = {
    kind: "generic",
    title: "Example",
    coverUrl: "https://example.com/cover.jpg",
    requestedRange: { startChapter: null, endChapter: null },
    providers: [],
    log: ["found chapters"],
    chapters: [
      { key: "0", number: 0, label: "Prologue", url: "https://example.com/chapter/0", options: [] },
      { key: "1", number: 1, label: "Chapter 1", url: "https://example.com/chapter/1", options: [] },
    ],
  };

  const result = publicDiscovery(discovery, "token123");
  assert.strictEqual(result.detectedKind, "generic");
  assert.strictEqual(result.discoveryToken, "token123");
  assert.strictEqual(result.coverUrl, "https://example.com/cover.jpg");
  assert.deepStrictEqual(
    result.chapters.map((chapter) => chapter.key),
    ["0", "1"],
  );
  assert.strictEqual(result.chapters[1].label, "Chapter 1");
  assert.deepStrictEqual(result.defaults.excludedPartKeys, []);
});

test("makeAsuraPreview builds prologue and numbered chapter URLs", () => {
  const chapters = makeAsuraPreview(
    { firstChapter: 1, lastChapter: 3 },
    { slug: "example-series" },
  );
  assert.deepStrictEqual(
    chapters.map((chapter) => chapter.url),
    [
      "https://asurascans.com/comics/example-series/chapter/0",
      "https://asurascans.com/comics/example-series/chapter/1",
      "https://asurascans.com/comics/example-series/chapter/2",
      "https://asurascans.com/comics/example-series/chapter/3",
    ],
  );
});

test("makeGenericPreview keeps discovered URLs and chapter numbers", () => {
  const chapters = makeGenericPreview({
    chapters: [
      { url: "https://example.com/chapter/1", num: 1 },
      { url: "https://example.com/chapter/7", num: 7 },
    ],
  });
  assert.deepStrictEqual(chapters.map((chapter) => chapter.key), ["1", "7"]);
  assert.deepStrictEqual(chapters.map((chapter) => chapter.label), ["Chapter 1", "Chapter 7"]);
});

test("normalizeChapterEdits validates URLs and scans added chapter numbers", () => {
  const edits = normalizeChapterEdits(
    {
      chapterUrlOverrides: { "1": "https://mirror.example/chapter/1" },
      addedChapters: [{ url: "https://example.com/chapter/9" }],
    },
    { startChapter: null, endChapter: null },
  );

  assert.deepStrictEqual(edits.overrides, { "1": "https://mirror.example/chapter/1" });
  assert.strictEqual(edits.added.length, 1);
  assert.strictEqual(edits.added[0].number, 9);
  assert.strictEqual(edits.added[0].key, "added:9");
});

test("normalizeChapterEdits rejects invalid custom chapter URLs", () => {
  assert.throws(
    () => normalizeChapterEdits({ chapterUrlOverrides: { "1": "javascript:alert(1)" } }, {}),
    /Invalid custom chapter URL/,
  );
});

test("normalizeExcludedPartKeys validates and deduplicates subchapter keys", () => {
  assert.deepStrictEqual(normalizeExcludedPartKeys(["2:2.5", "2:2.5", "40:40"]), ["2:2.5", "40:40"]);
  assert.throws(() => normalizeExcludedPartKeys("2:2.5"), /Excluded part keys must be a list/);
  assert.throws(() => normalizeExcludedPartKeys(["javascript"]), /must look like/);
});

test("buildPreviewJobSpec applies overrides, added chapters, and custom prologue", () => {
  const discovery = {
    title: "Example",
    coverUrl: "https://example.com/cover.jpg",
    chapters: [
      { key: "0", number: 0, label: "Prologue", url: "https://example.com/chapter/0" },
      { key: "1", number: 1, label: "Chapter 1", url: "https://example.com/chapter/1" },
      { key: "3", number: 3, label: "Chapter 3", url: "https://example.com/chapter/3" },
    ],
  };
  const edits = normalizeChapterEdits(
    {
      chapterUrlOverrides: {
        "1": "https://mirror.example/chapter/1",
        "0": "https://mirror.example/chapter/0",
      },
      addedChapters: [{ url: "https://example.com/chapter/2" }],
    },
    { startChapter: null, endChapter: null },
  );

  const spec = buildPreviewJobSpec(discovery, edits, { startChapter: null, endChapter: null });
  assert.deepStrictEqual(spec.chapterUrls, [
    "https://mirror.example/chapter/1",
    "https://example.com/chapter/2",
    "https://example.com/chapter/3",
  ]);
  assert.strictEqual(spec.prologueUrl, "https://mirror.example/chapter/0");
  assert.deepStrictEqual(
    spec.chapterMeta.map((meta) => meta.label),
    ["Chapter 1", "Chapter 2", "Chapter 3"],
  );
});

test("applyEditsToAtsuSpec replaces whole chapters, parts, and added chapters", () => {
  const spec = {
    chapterUrls: ["https://atsu.moe/read/a/1", "https://atsu.moe/read/a/2"],
    chapterMeta: [
      { number: 1, label: "1", url: "https://atsu.moe/read/a/1" },
      { number: 2, label: "2 (2 + 2.5)", detail: "Chapters 2 + 2.5", parts: [2, 2.5], partNumbers: [2, 2.5], combined: true },
    ],
    chapterParts: {
      1: ["https://atsu.moe/read/a/2", "https://atsu.moe/read/a/2-5"],
    },
    prologueUrl: "https://atsu.moe/read/a/0",
  };
  const edits = normalizeChapterEdits(
    {
      chapterUrlOverrides: {
        "1": "https://other.example/chapter/1",
        "2:2.5": "https://other.example/chapter/2-5",
        "0": "https://other.example/chapter/0",
      },
      addedChapters: [{ url: "https://example.com/chapter/9" }],
    },
    { startChapter: null, endChapter: null },
  );

  applyEditsToAtsuSpec(spec, edits);
  assert.strictEqual(spec.chapterUrls[0], "https://other.example/chapter/1");
  assert.strictEqual(spec.chapterParts[1][1], "https://other.example/chapter/2-5");
  assert.strictEqual(spec.prologueUrl, "https://other.example/chapter/0");
  assert.strictEqual(spec.chapterUrls[2], "https://example.com/chapter/9");
});
