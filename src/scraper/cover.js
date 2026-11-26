"use strict";

const cheerio = require("cheerio");

const ASURA_SELECTORS = [
  "#desktop-cover-container > div.rounded-md.z-0.w-full.h-full.absolute.top-0.left-0 > img",
  "#desktop-cover-container img",
];

const ATSU_SELECTORS = [
  "#root > div.min-h-dvh.grid.grid-cols-1.pt-safe.max-md\\:pb-safe-bottom-nav > div:nth-child(8) > div.w-full.min-w-0.max-w-\\(--wrapper\\).px-\\(--padding\\).mx-auto.max-md\\:px-0\\! > article > aside > div.relative.bg-cover.aspect-215\\/323.rounded-md > img",
  "article aside img",
];

const META_SELECTORS = [
  "meta[property='og:image']",
  "meta[name='twitter:image']",
  "link[rel='image_src']",
];

const GENERIC_SELECTORS = [
  ".cover img",
  ".cover-image img",
  ".series-cover img",
  ".book-cover img",
  ".poster img",
  ".thumb img",
  ".thumbnail img",
];

const CHAPTER_SEGMENT = /^(chapter|chap|ch|c|read|episode|ep)(?:[-_]?\d+)?$/i;
const BAD_IMAGE_PATH =
  /(^|\/)(logo|icon|avatar|banner|advert|ads?|sponsor|button|sprite|placeholder)(\/|$)/i;
const BAD_IMAGE_EXT = /\.(svg|ico)(\?.*)?$/i;
const IMAGE_ATTRS = ["content", "href", "src", "data-src", "data-original", "data-lazy-src", "data-url"];

function normalizeUrl(raw, base) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  try {
    const url = new URL(raw.trim(), base);
    if (!/^https?:$/.test(url.protocol)) return null;
    return url.href;
  } catch {
    return null;
  }
}

function allowedImageUrl(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    return !BAD_IMAGE_PATH.test(url.pathname) && !BAD_IMAGE_EXT.test(url.pathname);
  } catch {
    return false;
  }
}

function urlFromElement($, el, base) {
  for (const attr of IMAGE_ATTRS) {
    const url = normalizeUrl($(el).attr(attr), base);
    if (allowedImageUrl(url)) return url;
  }
  const srcset = $(el).attr("srcset") || "";
  for (const part of srcset.split(",")) {
    const first = part.trim().split(/\s+/)[0];
    const url = normalizeUrl(first, base);
    if (allowedImageUrl(url)) return url;
  }
  return null;
}

function firstFromSelectors($, selectors, base) {
  for (const selector of selectors) {
    const el = $(selector).first();
    if (el.length === 0) continue;
    const url = urlFromElement($, el, base);
    if (url) return url;
  }
  return null;
}

function findJsonImage(value, base) {
  if (typeof value === "string") {
    const url = normalizeUrl(value, base);
    return allowedImageUrl(url) ? url : null;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      const url = findJsonImage(item, base);
      if (url) return url;
    }
    return null;
  }
  if (!value || typeof value !== "object") return null;
  for (const key of ["image", "thumbnailUrl", "cover", "coverUrl"]) {
    const url = findJsonImage(value[key], base);
    if (url) return url;
  }
  return null;
}

function jsonLdImage($, base) {
  let found = null;
  $("script[type='application/ld+json']").each((_, el) => {
    if (found) return;
    try {
      found = findJsonImage(JSON.parse($(el).html() || ""), base);
    } catch {}
  });
  return found;
}

function scanGenericImages($, base) {
  const candidates = [];
  $("img").each((_, el) => {
    const url = urlFromElement($, el, base);
    if (!url) return;
    const hints = [
      $(el).attr("id"),
      $(el).attr("class"),
      $(el).attr("alt"),
      $(el).closest("[class]").attr("class"),
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    let score = 0;
    if (/cover|poster|thumb|thumbnail/.test(hints)) score += 100;
    const width = Number.parseInt($(el).attr("width"), 10) || 0;
    const height = Number.parseInt($(el).attr("height"), 10) || 0;
    score += Math.min(200, (width * height) / 1000);
    if ($(el).closest("article, main, aside").length > 0) score += 20;
    candidates.push({ url, score });
  });
  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] ? candidates[0].url : null;
}

function extractCoverUrl(html, { kind, baseUrl } = {}) {
  if (typeof html !== "string" || html.length === 0) return null;
  const $ = cheerio.load(html);
  const base = baseUrl || null;

  const specific =
    kind === "asura" ? ASURA_SELECTORS : kind === "atsu" ? ATSU_SELECTORS : GENERIC_SELECTORS;
  const specificUrl = firstFromSelectors($, specific, base);
  if (specificUrl) return specificUrl;

  if (kind === "generic") {
    const metaUrl = firstFromSelectors($, META_SELECTORS, base);
    if (metaUrl) return metaUrl;
    const structuredUrl = jsonLdImage($, base);
    if (structuredUrl) return structuredUrl;
    return scanGenericImages($, base);
  }

  return firstFromSelectors($, META_SELECTORS, base);
}

function seriesPageUrl(raw) {
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    const chapterIndex = parts.findIndex((part) => CHAPTER_SEGMENT.test(part));
    if (chapterIndex !== -1) {
      parts.length = chapterIndex;
    } else if (parts.length > 0 && /^\d+$/.test(parts[parts.length - 1])) {
      parts.pop();
    }
    url.pathname = parts.length > 0 ? `/${parts.join("/")}` : "/";
    url.search = "";
    url.hash = "";
    return url.href;
  } catch {
    return null;
  }
}

module.exports = { extractCoverUrl, seriesPageUrl };
