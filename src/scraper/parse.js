"use strict";

const cheerio = require("cheerio");

const ASURA_HOST = "asurascans.com";
const ATSU_HOST = "atsu.moe";
const IMAGE_PREFIX = "https://cdn.asurascans.com/asura-images/chapters/";
const SERIES_PATHS = ["comics", "series", "manga", "reads", "read", "manhwa", "comic"];
const CHAPTER_PATHS = ["chapter", "chap", "ch", "c"];

const IMAGE_EXT = /\.(webp|jpe?g|png|avif|gif)(\?.*)?$/i;

/**
 * Accepts a series or chapter URL from any manga/scanlation site and normalizes
 * it. Returns { kind, slug, chapter, baseUrl, sourceUrl } or throws on invalid
 * input. Asura URLs get the fast numeric path; all other hosts fall through to
 * the generic URL-walking path.
 */
function parseInputUrl(raw) {
  if (!raw || typeof raw !== "string") {
    throw new Error("Please provide a URL.");
  }
  let url;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error("That does not look like a valid URL.");
  }
  if (!/^https?:$/.test(url.protocol)) {
    throw new Error("URL must use http or https.");
  }
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);

  let categoryIdx = parts.findIndex((p) => SERIES_PATHS.includes(p));
  const isAsura = host === ASURA_HOST || host.endsWith("." + ASURA_HOST);

  if (isAsura) {
    if (categoryIdx === -1) {
      throw new Error("URL must look like https://asurascans.com/comics/{slug} or .../chapter/{N}");
    }
    const slug = parts[categoryIdx + 1];
    if (!/^[a-z0-9-]+$/.test(slug || "")) {
      throw new Error(`Could not parse comic slug from "${raw}".`);
    }
    let chapter = null;
    if (parts.includes("chapter")) {
      const chapterIdx = parts.indexOf("chapter");
      const n = Number.parseInt(parts[chapterIdx + 1], 10);
      if (!Number.isFinite(n)) throw new Error("Chapter number must be an integer.");
      chapter = n;
    }
    return {
      kind: "asura",
      slug,
      chapter,
      baseUrl: `https://${ASURA_HOST}/comics/${slug}`,
      sourceUrl: url.href,
    };
  }

  const isAtsu = host === ATSU_HOST || host === "www." + ATSU_HOST;

  if (isAtsu) {
    const first = parts[0];
    const idPattern = /^[A-Za-z0-9_-]+$/;
    if (!first || !["manga", "novel", "read"].includes(first)) {
      throw new Error("URL must look like https://atsu.moe/manga/{id} or https://atsu.moe/read/{id}/{chapterId}");
    }
    const mangaId = parts[1];
    if (!idPattern.test(mangaId || "")) {
      throw new Error(`Could not parse manga id from "${raw}".`);
    }
    const isNovel = first === "novel";
    const isReader = first === "read" || (isNovel && parts.length > 2);
    const chapterId = isReader ? parts[2] : null;
    if (isReader && !idPattern.test(chapterId || "")) {
      throw new Error(`Could not parse chapter id from "${raw}".`);
    }
    return {
      kind: "atsu",
      slug: mangaId,
      chapterId,
      medium: isNovel ? "Novel" : "Comic",
      chapter: null,
      baseUrl: `https://${ATSU_HOST}/${isNovel ? "novel" : "manga"}/${mangaId}`,
      sourceUrl: `https://${ATSU_HOST}${url.pathname}`,
    };
  }

  // Generic sites: best-effort slug extraction; chapter stays null unless an
  // integer is found in a chapter-ish segment.
  let slug = null;
  if (categoryIdx !== -1 && parts[categoryIdx + 1]) {
    slug = parts[categoryIdx + 1].replace(/\.(html?|php)$/, "");
  }
  let chapter = null;
  for (let i = 0; i < parts.length - 1; i++) {
    if (CHAPTER_PATHS.includes(parts[i])) {
      const n = Number.parseInt(parts[i + 1], 10);
      if (Number.isFinite(n)) chapter = n;
      break;
    }
  }
  if (chapter == null && parts.length >= 2 && categoryIdx === -1) {
    const n = Number.parseInt(parts[parts.length - 1], 10);
    if (Number.isFinite(n)) chapter = n;
  }

  return {
    kind: "generic",
    slug,
    chapter,
    baseUrl: url.origin + url.pathname.replace(/\/chapter\/[\d-]+.*$/, ""),
    sourceUrl: url.href,
  };
}

/** Extract ordered page-image URLs from a chapter page (Asura CDN only). */
function parseChapterImages(html) {
  const $ = cheerio.load(html);
  const imgs = [];
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (!src || !src.startsWith(IMAGE_PREFIX)) return;
    const clean = src.split("?")[0];
    const pageIndex = $(el).attr("data-page-index");
    imgs.push({
      url: clean,
      index: pageIndex !== undefined ? Number.parseInt(pageIndex, 10) : NaN,
    });
  });
  const allIndexed = imgs.length > 0 && imgs.every((i) => Number.isFinite(i.index));
  const ordered = allIndexed
    ? [...imgs].sort((a, b) => a.index - b.index)
    : imgs;
  return ordered.map((i) => i.url);
}

/**
 * Extract ordered page-image URLs from a chapter page on ANY site. Tries known
 * reader containers first, then falls back to any <img> in the article whose
 * src points at an image file. Handles lazy-loaded attributes (data-src,
 * data-lazy-src, data-original).
 */
function parseGenericChapterImages(html, pageUrl) {
  const $ = cheerio.load(html);
  const base = pageUrl || "http://localhost/";
  const containers = [
    "#readerarea",
    "#chapter-images",
    "#read",
    ".reading-content",
    ".entry-content",
    ".chapter-content",
    ".text-start",
    ".text-center",
    ".read-container",
    ".reader-area",
    ".chapter-reader",
    ".page-break",
    "article img",
  ];

  function srcOf(el) {
    const $el = $(el);
    return (
      $el.attr("data-src") ||
      $el.attr("data-lazy-src") ||
      $el.attr("data-original") ||
      $el.attr("src") ||
      ""
    );
  }

  let scope = $("body");
  for (const sel of containers) {
    const node = $(sel).first();
    if (!node.length) continue;
    scope = node.is("img") ? node.parent() : node;
    break;
  }

  const seen = new Set();
  const imgs = [];
  const nodes = scope.is("img") ? scope : scope.find("img");
  nodes.each((_, el) => {
    const raw = srcOf(el);
    if (!raw || raw.startsWith("data:")) return;
    let url;
    try {
      url = new URL(raw, base);
    } catch {
      return;
    }
    if (!/^https?:$/.test(url.protocol)) return;
    if (/(avatar|logo|icon|emoji|spacer|advert|badge|banner|loading|thumb|cover)/i.test(url.pathname)) return;
    if (!IMAGE_EXT.test(url.pathname)) return;
    const clean = url.origin + url.pathname;
    if (seen.has(clean)) return;
    seen.add(clean);
    const pageIndex = $(el).attr("data-page-index");
    imgs.push({
      url: clean,
      index: pageIndex !== undefined ? Number.parseInt(pageIndex, 10) : NaN,
    });
  });

  const allIndexed = imgs.length > 0 && imgs.every((i) => Number.isFinite(i.index));
  const ordered = allIndexed
    ? [...imgs].sort((a, b) => a.index - b.index)
    : imgs;
  return ordered.map((i) => i.url);
}

/** Read the <link rel="next"> chapter URL from a chapter page. */
function parseNextChapter(html) {
  const $ = cheerio.load(html);
  const href = $('link[rel="next"]').attr("href");
  return href || null;
}

const LOCK_MARKERS = [
  "premium",
  "locked",
  "unlock",
  "purchase",
  "subscribe to read",
  "members only",
  "become a patron",
];

/** Heuristic: a chapter page that returned no images may be gated. */
function isLockedPage(html) {
  const haystack = html.toLowerCase();
  return LOCK_MARKERS.some((m) => haystack.includes(m));
}

/** Parse the series page: title, numberOfEpisodes, and chapter links. */
function parseSeriesInfo(html) {
  const $ = cheerio.load(html);
  let title = $('meta[property="og:title"]').attr("content") || null;
  let numberOfEpisodes = null;

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).html() || "";
    let data;
    try {
      data = JSON.parse(raw);
    } catch {
      return;
    }
    const list = Array.isArray(data) ? data : [data];
    for (const item of list) {
      if (!item || typeof item !== "object") continue;
      if (item["@type"] === "ComicSeries" || Number.isFinite(item.numberOfEpisodes)) {
        if (Number.isFinite(item.numberOfEpisodes)) numberOfEpisodes = item.numberOfEpisodes;
        if (item.name && !title) title = item.name;
      }
    }
  });

  const chapterNumbers = new Set();
  $('a[href*="/chapter/"]').each((_, el) => {
    const href = $(el).attr("href") || "";
    const m = href.match(/\/chapter\/(\d+)/);
    if (m) chapterNumbers.add(Number.parseInt(m[1], 10));
  });

  return { title, numberOfEpisodes, chapterNumbers: [...chapterNumbers] };
}

module.exports = {
  parseInputUrl,
  parseChapterImages,
  parseGenericChapterImages,
  parseNextChapter,
  parseSeriesInfo,
  isLockedPage,
  IMAGE_PREFIX,
};
