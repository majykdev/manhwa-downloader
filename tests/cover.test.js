"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { extractCoverUrl, extractMetaCoverUrl, normalizeCoverUrl, seriesPageUrl } = require("../src/scraper/cover");

test("extractCoverUrl uses the Asura cover container selector", () => {
  const html = `
    <div id="desktop-cover-container">
      <div class="rounded-md z-0 w-full h-full absolute top-0 left-0">
        <img src="/covers/asura.webp" />
      </div>
    </div>
  `;
  assert.strictEqual(
    extractCoverUrl(html, { kind: "asura", baseUrl: "https://asurascans.com" }),
    "https://asurascans.com/covers/asura.webp",
  );
});

test("extractCoverUrl prefers the full-screen Asura viewer image", () => {
  const html = `
    <img id="cover-viewer-img" data-full-src="https://cdn.asurascans.com/asura-images/covers/series.a1.webp" />
    <div id="desktop-cover-container">
      <img src="https://cdn.asurascans.com/asura-images/covers/series.a1-400.webp" />
    </div>
  `;
  assert.strictEqual(
    extractCoverUrl(html, { kind: "asura", baseUrl: "https://asurascans.com" }),
    "https://cdn.asurascans.com/asura-images/covers/series.a1.webp",
  );
});

test("normalizeCoverUrl removes Asura -400 thumbnail suffix", () => {
  assert.strictEqual(
    normalizeCoverUrl("https://cdn.asurascans.com/asura-images/covers/series.a1-400.webp"),
    "https://cdn.asurascans.com/asura-images/covers/series.a1.webp",
  );
  assert.strictEqual(
    extractCoverUrl(
      `<div id="desktop-cover-container"><img src="https://cdn.asurascans.com/asura-images/covers/series.a1-400.jpg" /></div>`,
      { kind: "asura", baseUrl: "https://asurascans.com" },
    ),
    "https://cdn.asurascans.com/asura-images/covers/series.a1.jpg",
  );
});

test("extractCoverUrl uses the Atsu series-page cover selector", () => {
  const html = `
    <div id="root">
      <div class="min-h-dvh grid grid-cols-1 pt-safe max-md:pb-safe-bottom-nav">
        <div></div><div></div><div></div><div></div>
        <div></div><div></div><div></div>
        <div>
          <div class="w-full min-w-0 max-w-(--wrapper) px-(--padding) mx-auto max-md:px-0!">
            <article>
              <aside>
                <div class="relative bg-cover aspect-215/323 rounded-md">
                  <img src="/static/covers/atsu.webp" />
                </div>
              </aside>
            </article>
          </div>
        </div>
      </div>
    </div>
  `;
  assert.strictEqual(
    extractCoverUrl(html, { kind: "atsu", baseUrl: "https://atsu.moe" }),
    "https://atsu.moe/static/covers/atsu.webp",
  );
});

test("extractCoverUrl uses the rendered Atsu divider selector", () => {
  const html = `
    <div id="root">
      <div class="min-h-dvh grid grid-cols-1 pt-safe max-md:pb-safe-bottom-nav">
        <div class="contents">
          <div>
            <div class="w-full min-w-0 max-w-(--wrapper) px-(--padding) mx-auto max-md:px-0!">
              <article>
                <aside>
                  <div class="relative bg-cover aspect-215/323 rounded-md">
                    <img src="/static/covers/atsu-contents.webp" />
                  </div>
                </aside>
              </article>
            </div>
          </div>
        </div>
      </div>
    </div>
  `;
  assert.strictEqual(
    extractCoverUrl(html, { kind: "atsu", baseUrl: "https://atsu.moe" }),
    "https://atsu.moe/static/covers/atsu-contents.webp",
  );
});

test("extractCoverUrl can skip metadata and extractMetaCoverUrl reads it", () => {
  const html = `<meta property="og:image" content="https://atsu.moe/api/rs/og/series/iSeW.jpg?v=1" />`;
  assert.strictEqual(
    extractCoverUrl(html, {
      kind: "atsu",
      baseUrl: "https://atsu.moe/manga/iSeW",
      allowMeta: false,
    }),
    null,
  );
  assert.strictEqual(
    extractMetaCoverUrl(html, { baseUrl: "https://atsu.moe/manga/iSeW" }),
    "https://atsu.moe/api/rs/og/series/iSeW.jpg?v=1",
  );
});

test("extractCoverUrl finds generic covers from metadata and page images", () => {
  const metaHtml = `<meta property="og:image" content="/images/meta-cover.jpg" />`;
  assert.strictEqual(
    extractCoverUrl(metaHtml, { kind: "generic", baseUrl: "https://site.com/series/x" }),
    "https://site.com/images/meta-cover.jpg",
  );

  const imageHtml = `
    <article>
      <div class="series-cover"><img data-src="/uploads/poster.webp" /></div>
    </article>
  `;
  assert.strictEqual(
    extractCoverUrl(imageHtml, { kind: "generic", baseUrl: "https://site.com/series/x" }),
    "https://site.com/uploads/poster.webp",
  );
});

test("seriesPageUrl removes chapter segments and query strings", () => {
  assert.strictEqual(
    seriesPageUrl("https://site.com/series/tower-fantasy/chapter/42?style=list#top"),
    "https://site.com/series/tower-fantasy",
  );
  assert.strictEqual(
    seriesPageUrl("https://site.com/manga/abc/chap-12"),
    "https://site.com/manga/abc",
  );
  assert.strictEqual(
    seriesPageUrl("https://site.com/comics/abc"),
    "https://site.com/comics/abc",
  );
});
