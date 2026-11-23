"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const cheerio = require("cheerio");

const {
  parseInputUrl,
  parseGenericChapterImages,
} = require("../src/scraper/parse");
const {
  extractChapterNum,
  isChapterAnchor,
  collectCandidateLinks,
} = require("../src/scraper/generic");
const { JobStore } = require("../src/jobs/store");

test("parseInputUrl accepts any host as generic", () => {
  const parsed = parseInputUrl("https://flamescans.org/series/tower-fantasy");
  assert.strictEqual(parsed.kind, "generic");
  assert.strictEqual(parsed.slug, "tower-fantasy");
  assert.strictEqual(parsed.chapter, null);
});

test("parseInputUrl extracts a chapter number from generic URLs", () => {
  const parsed = parseInputUrl(
    "https://flamescans.org/series/tower-fantasy/chapter/42",
  );
  assert.strictEqual(parsed.kind, "generic");
  assert.strictEqual(parsed.slug, "tower-fantasy");
  assert.strictEqual(parsed.chapter, 42);
});

test("parseInputUrl still accepts Asura as its own kind", () => {
  const parsed = parseInputUrl(
    "https://asurascans.com/comics/trash-of-the-counts-family-7e1f454a/chapter/0",
  );
  assert.strictEqual(parsed.kind, "asura");
  assert.strictEqual(parsed.slug, "trash-of-the-counts-family-7e1f454a");
  assert.strictEqual(parsed.chapter, 0);
});

test("parseInputUrl rejects non-http URLs", () => {
  assert.throws(() => parseInputUrl("ftp://example.com/x"), /http/);
  assert.throws(() => parseInputUrl("not a url"), /valid URL/);
});

const GENERIC_CHAPTER = `
<html>
<head>
  <link rel="next" href="https://flamescans.org/series/tower-fantasy/chapter/43" />
</head>
<body>
  <div class="reading-content">
    <img data-src="https://cdn.flamescans.org/tower/042/1.webp?v=1" alt="" />
    <img data-src="https://cdn.flamescans.org/tower/042/2.webp?v=2" alt="" />
    <img src="https://cdn.flamescans.org/logo.png" alt="logo" />
    <img src="https://cdn.flamescans.org/tower/042/3.webp" alt="" />
  </div>
</body>
</html>
`;

test("parseGenericChapterImages extracts reader images in order and strips query strings", () => {
  const urls = parseGenericChapterImages(
    GENERIC_CHAPTER,
    "https://flamescans.org/series/tower-fantasy/chapter/42",
  );
  assert.strictEqual(urls.length, 3);
  assert.ok(urls[0].endsWith("/1.webp"));
  assert.ok(urls[1].endsWith("/2.webp"));
  assert.ok(urls[2].endsWith("/3.webp"));
  assert.ok(urls.every((u) => !u.includes("?")));
});

test("parseGenericChapterImages ignores avatars and non-image assets", () => {
  const html = `
    <html><body>
      <div class="read-container">
        <img src="https://cdn.site.com/avatar-me.png" />
        <img data-src="https://cdn.site.com/pg/01.jpg" />
        <img src="https://cdn.site.com/advert/banner.svg" />
      </div>
    </body></html>
  `;
  const urls = parseGenericChapterImages(html, "https://site.com/chapter/1");
  assert.deepStrictEqual(urls, ["https://cdn.site.com/pg/01.jpg"]);
});

test("JobStore findRetryable returns only image-download failed chapters", () => {
  const store = new JobStore();
  const job = store.create({ kind: "generic", chapterUrls: ["a", "b", "c"] });
  store.setChapter(job, 0, { status: "done", pagesDone: 5, pagesTotal: 5 });
  store.setChapter(job, 1, {
    status: "skipped",
    reason: "image download failed (ECONNRESET)",
  });
  store.setChapter(job, 2, { status: "skipped", reason: "locked/premium" });
  assert.deepStrictEqual(store.findRetryable(job), [1]);
});

test("JobStore snapshot exposes sorted chapters with labels", () => {
  const store = new JobStore();
  const job = store.create({ kind: "generic", chapterUrls: ["a", "b"] });
  store.setChapter(job, 0, { status: "pending", label: 42 });
  store.setChapter(job, 1, { status: "pending", label: 43 });
  const snap = store.snapshot(job.id);
  assert.strictEqual(snap.chapters.length, 2);
  assert.strictEqual(snap.chapters[0].label, 42);
  assert.strictEqual(snap.retryable.length, 0);
});

test("extractChapterNum reads number from various URL shapes", () => {
  assert.strictEqual(extractChapterNum("https://s.com/manga/x/12"), 12);
  assert.strictEqual(extractChapterNum("https://s.com/read/x/3"), 3);
  assert.strictEqual(extractChapterNum("https://s.com/series/x/chapter-42"), 42);
  assert.strictEqual(extractChapterNum("https://s.com/x/chap/7"), 7);
  assert.strictEqual(extractChapterNum("https://s.com/x/ch-9"), 9);
  assert.strictEqual(extractChapterNum("https://s.com/x/c/11"), 11);
  assert.ok(Number.isNaN(extractChapterNum("https://s.com/about")));
});

test("isChapterAnchor accepts real chapter links and rejects noise", () => {
  const cases = [
    ["https://s.com/manga/foo/127", "Chapter 127", true],
    ["https://s.com/manga/foo/127", "127", true],
    ["https://s.com/manga/foo/127", "Read", true],
    ["https://s.com/read/foo-42", "Read 42", true],
    ["https://s.com/tag/action", "Action", false],
    ["https://s.com/genre/2", "Genre", false],
    ["https://s.com/category/foo", "News", false],
    ["https://s.com/page/3", "3", false],
    ["https://s.com/about", "About", false],
    ["https://s.com/author/bob", "Bob", false],
    ["https://s.com/search/foo", "Search", false],
    ["https://s.com/manga/foo/500001", "500001", false],
  ];
  for (const [href, text, expected] of cases) {
    assert.strictEqual(isChapterAnchor(href, text), expected, `${href} (${text})`);
  }
});

test("collectCandidateLinks finds chapters across the whole page", () => {
  const html = `
    <html><body>
      <a href="/manga/foo/1">Chapter 1</a>
      <a href="/manga/foo/2">Chapter 2</a>
      <a href="/manga/foo/3">Chapter 3</a>
      <a href="/tag/action">Action</a>
      <a href="/page/2">Next page</a>
      <a href="/about">About</a>
      <a href="https://other.com/manga/other/1">Other series</a>
    </body></html>
  `;
  const $ = cheerio.load(html);
  const links = collectCandidateLinks($, "https://s.com/manga/foo/1");
  const urls = links.map((l) => l.url).sort();
  assert.deepStrictEqual(urls, [
    "https://s.com/manga/foo/1",
    "https://s.com/manga/foo/2",
    "https://s.com/manga/foo/3",
  ]);
});