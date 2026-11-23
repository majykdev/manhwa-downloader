"use strict";

const cheerio = require("cheerio");
const config = require("../config");
const {
  parseGenericChapterImages,
  parseNextChapter,
  isLockedPage,
} = require("./parse");
const { fetchWithRetry, fetchPageSmart } = require("./http");
const render = require("./render");

const MAX_CHAPTERS = 5000;

class NotFoundError extends Error {}
class InvalidChapterError extends Error {}

function toAbsolute(raw, base) {
  try {
    return new URL(raw, base).href;
  } catch {
    return null;
  }
}

function extractChapterNum(url) {
  const m =
    url.match(/\/chapter\/(\d+)/) ||
    url.match(/\/chap\/[-_]?(\d+)/) ||
    url.match(/\/ch\/?[-_]?(\d+)/) ||
    url.match(/\/c\/(\d+)/) ||
    url.match(/\/chapter[-_]?(\d+)/) ||
    url.match(/\/read\/(\d+)/) ||
    url.match(/\/episode\/(\d+)/) ||
    url.match(/\/ep[-_]?(\d+)/);
  if (m) return Number.parseInt(m[1], 10);
  const t = url.match(/[^/]+\/(\d+)\/?$/);
  return t ? Number.parseInt(t[1], 10) : NaN;
}

const PATH_NOISE =
  /(^|\/)(tag|genre|category|author|search|feed|wp-content|wp-includes|assets|static|coupon|advert|sidebar|comment|news|page|p)(\/|$)/i;
const LIST_KEYWORDS =
  /\b(manga|comic|comics|series|reads|read|webtoon|novel|manhwa|manhua|story|title)\b/i;

/**
 * Heuristic: does this anchor look like it points at a chapter page? Combines
 * the href shape (explicit chapter markers or a trailing numeric segment) with
 * the anchor text, and rejects obvious navigation/pagination noise.
 */
function isChapterAnchor(abs, text) {
  if (/^(javascript:|#|mailto:|tel:)/i.test(abs)) return false;
  let path;
  try {
    path = new URL(abs).pathname;
  } catch {
    return false;
  }
  if (PATH_NOISE.test(path)) return false;
  if (
    /(\/chapter\/|\/chap\/|\/ch\/|\/c\/|\/read\/|\/episode\/|\/chapter-|\/ch-|\/ep-)/i.test(
      path,
    )
  ) {
    return true;
  }
  const trailing = path.match(/\/([^/]+)\/(\d+)\/?$/);
  if (!trailing) return false;
  const [, , num] = trailing;
  if (Number.parseInt(num, 10) > 200000) return false;
  const textClean = text.trim();
  const textHints = /^(chapter|chap|ch|episode|ep)\b|chapter\s*(\d+)|^\d+(\s*[-:/]\s*\d+)?$/i.test(
    textClean,
  );
  if (textHints) return true;
  // Fallback for thumbnail grids whose links are bare numbers / empty / "Read":
  // only useful if the URL looks like a chapter path AND the text isn't a
  // series/menu label (e.g. "Other series", "News", "Browse manga").
  if (!LIST_KEYWORDS.test(path)) return false;
  return !/series|manga|comic|novel|webtoon|author|related|news|menu|home|search|back|next/i.test(
    textClean,
  );
}

/**
 * Scrub the ENTIRE page for anchor links and keep the ones that plausibly point
 * at chapters, so sites with unusual chapter URL shapes (/manga/slug/127,
 * /read/foo-42, ordinary thumbnails) are still discoverable.
 */
function collectCandidateLinks($, startUrl) {
  const out = [];
  const seen = new Set();
  $("a[href]").each((_, el) => {
    const $el = $(el);
    const href = $el.attr("href") || "";
    const abs = toAbsolute(href, startUrl);
    if (!abs || seen.has(abs)) return;
    const text = $el.text().trim();
    if (!isChapterAnchor(abs, text)) return;
    seen.add(abs);
    out.push({ url: abs, num: extractChapterNum(abs) });
  });
  return out;
}

/**
 * Walk rel="next" links forward from a known chapter URL until the series runs
 * out or a loop is detected. Returns [{ url, num }] in reading order.
 */
async function walkNext(startUrl, onLog) {
  const chapters = [];
  const seenUrls = new Set();
  let current = startUrl;
  for (let hops = 0; hops < MAX_CHAPTERS; hops++) {
    if (seenUrls.has(current)) break;
    seenUrls.add(current);
    const num = extractChapterNum(current);
    chapters.push({ url: current, num });
    let next;
    try {
      const res = await fetchWithRetry(current, { attempts: 2 });
      if (res.status === 404) break;
      next = parseNextChapter(res.data);
    } catch {
      break;
    }
    if (!next) break;
    const abs = toAbsolute(next, current);
    if (!abs) break;
    if (seenUrls.has(abs)) break;
    current = abs;
    onLog(`Walking chapters… currently at ${chapters.length}`);
  }
  return chapters;
}

/**
 * Discover chapters for a generic site. Accepts either a chapter URL (walk
 * rel="next" forward from it) or a series/archive page (collect chapter links).
 * Returns { title, firstChapterUrl, chapters: [{ url, num }], needFirstChapter }
 */
async function discoverSeries(inputUrl, chapterUrl = null, onLog = () => {}) {
  const startUrl = chapterUrl || inputUrl;

  const res = await fetchPageSmart(startUrl, { attempts: 2 });
  if (res.error) {
    throw new NotFoundError(`Could not fetch page: ${startUrl} (${res.error})`);
  }
  if (res.status === 404) {
    throw new NotFoundError(`Page not found: ${startUrl}`);
  }
  let html = res.data;
  if (Buffer.isBuffer(html)) html = html.toString("utf8");
  let $ = cheerio.load(html);

  const title =
    $('meta[property="og:title"]').attr("content") ||
    $("h1").first().text().trim() ||
    $('meta[property="og:site_name"]').attr("content") ||
    "Untitled";

  // Collect all chapter links on the page. First pass: structured selectors
  // (fast path). If they come up thin, fall back to scrubbing every anchor.
  // TODO(later): if both passes fail, probe the page's own code to learn how
  // chapter links are generated (embedded JSON, __NEXT_DATA__/astro:props,
  // pagination/AJAX load-more) instead of requesting NEED_FIRST_CHAPTER.
  const links = [];
  $('a[href*="/chapter/"], a[href*="/chap/"], a[href*="/c/"], a[href*="/read/"]').each(
    (_, el) => {
      const href = $(el).attr("href") || "";
      const abs = toAbsolute(href, startUrl);
      if (!abs) return;
      links.push({ url: abs, num: extractChapterNum(abs) });
    },
  );

  const unique = new Map();
  for (const l of links) unique.set(l.url, l);
  let candidates = [...unique.values()];

  if (candidates.length === 0) {
    const scanned = collectCandidateLinks($, startUrl);
    if (scanned.length > 0) {
      onLog(
        `No structured chapter links; scrubbed all anchors and found ${scanned.length} chapter-like links.`,
      );
      candidates = scanned;
    }
  } else if (candidates.length <= 2) {
    const scanned = collectCandidateLinks($, startUrl);
    const extra = scanned.filter((c) => !unique.has(c.url));
    if (extra.length > 0) {
      for (const c of extra) unique.set(c.url, c);
      onLog(`Boosted a sparse list with ${extra.length} additional anchor-scanned links.`);
      candidates = [...unique.values()];
    }
  }

  if (candidates.length === 0 && config.JS_RENDER_ENABLED) {
    // The page may be a JS-driven SPA that only renders its chapter list
    // after client scripts run. Browse it, then re-run the same scans on the
    // live DOM.
    if (render.available) {
      onLog("No chapter links in static HTML — rendering page to look for them…");
      const out = await renderPageSafe(startUrl);
      if (!out.blocked && out.html) {
        const $r = cheerio.load(out.html);
        const scanned = collectCandidateLinks($r, startUrl);
        if (scanned.length > 0) {
          onLog(`Found ${scanned.length} chapter links in the rendered page.`);
          candidates = scanned;
        }
      }
    }
  }

  if (candidates.length === 0) {
    // No chapter links at all: maybe a bare chapter page or a failed fetch.
    const num = extractChapterNum(startUrl);
    if (Number.isFinite(num)) {
      onLog(`No chapter list found; walking rel="next" from ${startUrl}.`);
      const walked = await walkNext(startUrl, onLog);
      if (walked.length === 0) {
        return { title, needFirstChapter: true };
      }
      return {
        title,
        firstChapterUrl: walked[0].url,
        chapters: walked,
        needFirstChapter: false,
      };
    }
    onLog(`No chapter links found on ${startUrl}; fetch a chapter page and retry.`);
    return { title, needFirstChapter: true };
  }

  // A chapter page only carries prev/next links; a series page carries many.
  // If it's clearly a single-chapter page, walk forward instead of trusting 2 links.
  if (candidates.length <= 2) {
    onLog(`Found only ${candidates.length} chapter link(s); walking rel="next".`);
    const walked = await walkNext(startUrl, onLog);
    const merged = [...candidates, ...walked];
    const dedup = new Map();
    for (const c of merged) dedup.set(c.url, c);
    const list = [...dedup.values()];
    if (list.length === 0) return { title, needFirstChapter: true };
    return {
      title,
      firstChapterUrl: list[0].url,
      chapters: list,
      needFirstChapter: false,
    };
  }

  const sorted = [...candidates]
    .sort((a, b) => (Number.isFinite(a.num) && Number.isFinite(b.num) ? a.num - b.num : 0))
    .slice(0, MAX_CHAPTERS);

  return {
    title,
    firstChapterUrl: sorted[0].url,
    chapters: sorted,
    needFirstChapter: false,
  };
}

/**
 * Fetch a single chapter page from a generic site by explicit URL.
 * First tries static HTML; if it yields no images, renders the page in a
 * headless browser (lazy-loaded / JS-rendered readers) and extracts the live
 * DOM's image URLs. Returns { images, locked, blocked, notFound, title, rendered }.
 */
async function fetchChapter(url) {
  const res = await fetchPageSmart(url, { attempts: 2 });
  if (res.status === 404) {
    return { images: [], locked: false, blocked: false, notFound: true, title: null };
  }
  let html = res.data;
  if (Buffer.isBuffer(html)) html = html.toString("utf8");
  let parsedTitle =
    cheerio.load(html)('meta[property="og:title"]').attr("content") || null;
  let images = parseGenericChapterImages(html, url);
  let locked = images.length === 0 && isLockedPage(html);
  let blocked = false;
  let rendered = false;

  if (images.length === 0 && config.JS_RENDER_ENABLED && !locked) {
    if (render.available) {
      const out = await renderPageSafe(url, { title: parsedTitle });
      rendered = true;
      if (out.error) {
        // render hit a hard failure (e.g. no playwright) — leave as-is.
      } else if (out.blocked) {
        blocked = true;
        parsedTitle = parsedTitle || out.title;
      } else {
        images = parseGenericChapterImages(out.html, url);
        if (images.length === 0) images = out.imgUrls;
        locked = images.length === 0 && isLockedPage(out.html);
        parsedTitle = parsedTitle || out.title;
      }
    }
  }

  return { images, locked, blocked, notFound: false, title: parsedTitle, rendered };
}

/**
 * Render a page but never let a missing Playwright break discovery.
 * Falls back to a safe empty result when unavailable.
 */
async function renderPageSafe(url, opts = {}) {
  try {
    return await render.renderPage(url, opts);
  } catch (err) {
    return { imgUrls: [], html: "", title: opts.title || null, blocked: null, error: err.message };
  }
}

/**
 * Chapter image URLs may point at CDNs that reject plain axios (hotlink /
 * signed). Grab the bytes through a real browser context instead.
 */
async function fetchViaBrowser(url, opts = {}) {
  try {
    return await render.fetchViaBrowser(url, opts);
  } catch {
    return null;
  }
}

module.exports = {
  discoverSeries,
  fetchChapter,
  fetchViaBrowser,
  toAbsolute,
  extractChapterNum,
  isChapterAnchor,
  collectCandidateLinks,
  renderPageSafe,
  NotFoundError,
  InvalidChapterError,
  MAX_CHAPTERS,
};