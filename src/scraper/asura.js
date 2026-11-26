"use strict";

const cheerio = require("cheerio");
const {
  parseChapterImages,
  parseNextChapter,
  parseSeriesInfo,
  isLockedPage,
} = require("./parse");
const { fetchPageSmart, downloadBuffer } = require("./http");

const MAX_CHAPTERS = 5000;

class NotFoundError extends Error {}
class InvalidChapterError extends Error {}

function chapterUrl(slug, n) {
  return `https://asurascans.com/comics/${slug}/chapter/${n}`;
}

/**
 * Resolve the numbered chapter range. Chapter 0 is an optional prologue: it is
 * never the start of the count, and the actual chapter links win over the
 * JSON-LD count (which assumes numbering from 0).
 */
function resolveChapterBounds(info, startChapter, endChapter = null) {
  const links = (info.chapterNumbers || []).filter((n) => Number.isFinite(n));
  const regular = links.filter((n) => n > 0);
  const start = Number.isFinite(startChapter) && startChapter > 0 ? startChapter : null;

  const firstChapter = start ?? (regular.length > 0 ? Math.min(...regular) : 1);

  const candidates = [];
  if (links.length > 0) candidates.push(Math.max(...links));
  if (info.numberOfEpisodes != null) candidates.push(info.numberOfEpisodes - 1);
  let lastChapter = candidates.length > 0 ? Math.max(...candidates) : null;

  if (Number.isFinite(endChapter) && endChapter >= 0) {
    lastChapter = lastChapter == null ? endChapter : Math.min(lastChapter, endChapter);
  }

  return { firstChapter, lastChapter };
}

/**
 * Discover the chapter range for a series by reading the series page.
 * Falls back to the smallest/largest chapter numbers found in its links,
 * then to walking rel="next" one chapter at a time.
 */
async function discoverRange(slug, startChapter, onLog = () => {}, endChapter = null) {
  const baseUrl = `https://asurascans.com/comics/${slug}`;
  const res = await fetchPageSmart(baseUrl, { attempts: 2 });
  if (res.status === 404) {
    throw new NotFoundError(`Series not found: ${baseUrl}`);
  }
  let html = res.data;
  if (Buffer.isBuffer(html)) html = html.toString("utf8");
  const info = parseSeriesInfo(html);
  const title = info.title || slug;
  const coverUrl = info.coverUrl || null;

  let { firstChapter, lastChapter } = resolveChapterBounds(info, startChapter, endChapter);

  if (lastChapter == null) {
    onLog(`Chapter count not found on series page; walking rel="next" links…`);
    lastChapter = await walkNext(slug, firstChapter, onLog);
  }

  if (firstChapter > lastChapter) {
    throw new InvalidChapterError(
      `Start chapter ${firstChapter} is past the last chapter (${lastChapter}).`,
    );
  }

  return { title, coverUrl, firstChapter, lastChapter };
}

async function walkNext(slug, start, onLog) {
  let n = start;
  for (let hops = 0; hops < MAX_CHAPTERS; hops++) {
    const res = await fetchPageSmart(chapterUrl(slug, n), { attempts: 1 });
    if (res.status === 404) break;
    let data = res.data;
    if (Buffer.isBuffer(data)) data = data.toString("utf8");
    const next = parseNextChapter(data);
    if (!next) break;
    const m = next.match(/\/chapter\/(\d+)/);
    if (!m) break;
    const nextN = Number.parseInt(m[1], 10);
    if (nextN <= n) break; // safety: prevent loops
    n = nextN;
    onLog(`Walking chapters… currently at ${n}`);
  }
  return n;
}

/**
 * Fetch a single chapter page.
 * Returns { images, locked, notFound, title }.
 */
async function fetchChapter(slug, chapter) {
  return fetchChapterFromUrl(chapterUrl(slug, chapter));
}

function downloadImage(url, onRetry) {
  return downloadBuffer(url, { onRetry });
}

async function fetchChapterFromUrl(url) {
  const res = await fetchPageSmart(url, { attempts: 2 });
  if (res.status === 404) {
    return { images: [], locked: false, notFound: true, title: null };
  }
  let data = res.data;
  if (Buffer.isBuffer(data)) data = data.toString("utf8");
  const images = parseChapterImages(data);
  const locked = images.length === 0 && isLockedPage(data);
  const title = cheerio.load(data)('meta[property="og:title"]').attr("content") || null;
  return { images, locked, notFound: false, title };
}

module.exports = {
  discoverRange,
  resolveChapterBounds,
  fetchChapter,
  downloadImage,
  chapterUrl,
};
