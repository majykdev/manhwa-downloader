"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const {
  groupChapters,
  rankProviders,
  selectChapters,
  buildJobSpec,
  logicalChapters,
  parseReaderUrl,
  normaliseImage,
} = require("../src/scraper/atsu");

function chapter(id, providerId, number, createdAt = 1) {
  return {
    id,
    scanlationMangaId: providerId,
    number,
    title: `Chapter ${number}`,
    pageCount: 10,
    createdAt,
  };
}

function makeDiscovery() {
  const scanlators = [
    { id: "A", name: "Alpha", score: 0 },
    { id: "B", name: "Beta", score: 1 },
    { id: "C", name: "Gamma", score: 2 },
  ];
  const raw = [];
  for (let n = 1; n <= 40; n++) raw.push(chapter(`a${n}`, "A", n));
  for (let n = 1; n <= 10; n++) raw.push(chapter(`b${n}`, "B", n, 2));
  for (let n = 41; n <= 57; n++) raw.push(chapter(`b${n}`, "B", n, 2));
  raw.push(chapter("c05", "C", 40.5, 3));
  raw.push(chapter("c00", "C", 0, 3));

  const chapters = groupChapters(raw, scanlators, "Comic", "ehgv");
  const providers = rankProviders(chapters, scanlators);
  return {
    title: "Test Series",
    coverUrl: "https://cdn.atsu.moe/static/covers/ehgv.webp",
    mangaId: "ehgv",
    medium: "Comic",
    providers,
    chapters,
    log: [],
  };
}

function pick(selection, number) {
  return selection.chapters.find((option) => option.number === number);
}

test("groupChapters sorts numeric and decimal chapters and maps provider names", () => {
  const discovery = makeDiscovery();
  assert.deepStrictEqual(
    discovery.chapters.map((group) => group.number),
    [0, ...Array.from({ length: 57 }, (_, i) => i + 1), 40.5].sort((a, b) => a - b),
  );
  assert.strictEqual(discovery.providers[0].name, "Alpha");
  assert.strictEqual(discovery.providers[0].chapterCount, 40);
});

test("logicalChapters combines an integer chapter with its decimal parts", () => {
  const discovery = makeDiscovery();
  const logical = logicalChapters(discovery.chapters);
  const chapter40 = logical.find((group) => group.number === 40);
  assert.strictEqual(chapter40.combined, true);
  assert.deepStrictEqual(chapter40.parts.map((part) => part.number), [40, 40.5]);
  assert.strictEqual(logical.find((group) => group.number === 40.5), undefined);
});

test("default selection uses the largest provider and fills its gaps", () => {
  const selection = selectChapters(makeDiscovery());
  assert.strictEqual(pick(selection, 1).providerId, "A");
  assert.strictEqual(pick(selection, 40).providerId, "A");
  assert.deepStrictEqual(pick(selection, 40).parts.map((part) => part.number), [40, 40.5]);
  assert.strictEqual(pick(selection, 40).parts[1].providerId, "C");
  assert.strictEqual(pick(selection, 41).providerId, "B");
  assert.strictEqual(pick(selection, 57).providerId, "B");
  assert.strictEqual(selection.prologue.providerId, "C");
  assert.strictEqual(pick(selection, 0), undefined);
});

test("sourceOrder controls provider priority without changing chapter order", () => {
  const selection = selectChapters(makeDiscovery(), { sourceOrder: ["B", "A", "C"] });
  assert.strictEqual(pick(selection, 1).providerId, "B");
  assert.strictEqual(pick(selection, 41).providerId, "B");
  assert.deepStrictEqual(
    selection.chapters.map((option) => option.number),
    selection.chapters.map((option) => option.number).sort((a, b) => a - b),
  );
});

test("disabled providers are used automatically only as a fallback", () => {
  const selection = selectChapters(makeDiscovery(), { enabledSourceIds: ["C"] });
  assert.strictEqual(pick(selection, 1).providerId, "A");
  assert.strictEqual(pick(selection, 41).providerId, "B");
  assert.strictEqual(pick(selection, 40).providerId, "A");
  assert.strictEqual(pick(selection, 40).parts[1].providerId, "C");
  assert.strictEqual(selection.fallbackNumbers.length, 57);
});

test("chapterOverrides win over source order", () => {
  const selection = selectChapters(makeDiscovery(), {
    sourceOrder: ["A", "B", "C"],
    chapterOverrides: { 1: "B" },
  });
  assert.strictEqual(pick(selection, 1).providerId, "B");
});

test("buildJobSpec produces reader URLs, combined chapters, and a prologue URL", () => {
  const spec = buildJobSpec(makeDiscovery(), {});
  assert.strictEqual(spec.coverUrl, "https://cdn.atsu.moe/static/covers/ehgv.webp");
  assert.strictEqual(spec.chapterUrls.length, 57);
  assert.strictEqual(spec.chapterUrls[0], "https://atsu.moe/read/ehgv/a1");
  assert.strictEqual(spec.chapterUrls.at(-1), "https://atsu.moe/read/ehgv/b57");
  assert.strictEqual(spec.prologueUrl, "https://atsu.moe/read/ehgv/c00");
  assert.strictEqual(spec.chapterMeta[0].provider, "Alpha");
  assert.ok(spec.log.some((line) => line.includes("Primary provider: Alpha")));

  const chapter40Index = spec.chapterMeta.findIndex((meta) => meta.number === 40);
  const chapter40 = spec.chapterMeta[chapter40Index];
  assert.strictEqual(chapter40.label, "40 (40 + 40.5)");
  assert.deepStrictEqual(chapter40.partNumbers, [40, 40.5]);
  assert.strictEqual(spec.chapterParts[chapter40Index].length, 2);
});

test("buildJobSpec applies a manual range to logical chapters", () => {
  const spec = buildJobSpec(makeDiscovery(), { startChapter: 40, endChapter: 41 });
  assert.deepStrictEqual(spec.chapterMeta.map((meta) => meta.number), [40, 41]);
  assert.strictEqual(spec.chapterMeta[0].combined, true);
});

test("reader URLs and CDN image paths normalize correctly", () => {
  assert.deepStrictEqual(parseReaderUrl("https://atsu.moe/read/ehgv/aKF-UT"), {
    mangaId: "ehgv",
    chapterId: "aKF-UT",
    medium: "Comic",
  });
  assert.strictEqual(parseReaderUrl("https://atsu.moe/manga/ehgv"), null);
  assert.strictEqual(
    normaliseImage("/static/pages/x/y.avif"),
    "https://cdn.atsu.moe/static/pages/x/y.avif",
  );
  assert.strictEqual(
    normaliseImage("https://cdn.atsu.moe/static/x.webp"),
    "https://cdn.atsu.moe/static/x.webp",
  );
});
