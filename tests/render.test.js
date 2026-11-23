"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { parseGenericChapterImages } = require("../src/scraper/parse");
const { isCloudflareBlock } = require("../src/scraper/tls");
const { collectCandidateLinks, renderPageSafe } = require("../src/scraper/generic");
const render = require("../src/scraper/render");
const cheerio = require("cheerio");

test("parseGenericChapterImages returns [] (not a crash) when no reader container matches", () => {
  const html =
    '<html><body><div><p>No images here at all</p></div><script src="/assets/app.js"></script></body></html>';
  const urls = parseGenericChapterImages(html, "https://s.com/chapter/1");
  assert.deepStrictEqual(urls, []);
});

test("parseGenericChapterImages keeps working when a container matches", () => {
  const html = `
    <html><body>
      <div class="reading-content">
        <img src="https://cdn.s.com/a/1.webp">
        <img data-src="https://cdn.s.com/a/2.webp">
      </div>
    </body></html>
  `;
  const urls = parseGenericChapterImages(html, "https://s.com/chapter/1");
  assert.strictEqual(urls.length, 2);
  assert.ok(urls[0].endsWith("/1.webp"));
  assert.ok(urls[1].endsWith("/2.webp"));
});

test("isCloudflareBlock detects challenge pages and ignores normal pages", () => {
  assert.strictEqual(
    isCloudflareBlock("Just a moment... verifying you are human", 403),
    true,
  );
  assert.strictEqual(
    isCloudflareBlock("<html>challenge-platform</html>", 503),
    true,
  );
  assert.strictEqual(isCloudflareBlock("<html>all good</html>", 200), false);
  assert.strictEqual(
    isCloudflareBlock("<html><h1>Page not found</h1></html>", 404),
    false,
  );
});

test("collectCandidateLinks works on a raw rendered-style DOM", () => {
  const html = `
    <html><body>
      <a href="/manga/foo/1">Chapter 1</a>
      <a href="/manga/foo/2">Chapter 2</a>
      <a href="/manga/foo/3">Chapter 3</a>
    </body></html>
  `;
  const $ = cheerio.load(html);
  const links = collectCandidateLinks($, "https://s.com/manga/foo/1");
  assert.strictEqual(links.length, 3);
});

test("renderPageSafe degrades gracefully when render is unavailable", async () => {
  // renderPageSafe should never throw, even if playwright is missing/broken.
  const out = await renderPageSafe("https://s.com/manga/foo/1");
  assert.ok(Array.isArray(out.imgUrls));
  assert.ok(typeof out.html === "string");
  await render.close();
});