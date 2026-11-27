"use strict";

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Run `fn` for each item with at most `limit` concurrent invocations. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;

  async function worker() {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  const n = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: n }, () => worker());
  await Promise.all(workers);
  return results;
}

function sanitizeFilename(name) {
  const clean = name
    .replace(/[^\w\d\s\-_]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return clean || "series";
}

function chapterDisplayLabel(value) {
  if (value === null || value === undefined) return "Chapter";
  const text = String(value).trim();
  if (!text) return "Chapter";
  if (/^(?:chapter\s*)?0(?:\.0+)?$/i.test(text)) return "Prologue";
  if (/^\d+(?:\.\d+)?$/.test(text)) return `Chapter ${text}`;
  if (/^chapter\b/i.test(text) || /^prologue\b/i.test(text)) return text;
  return `Chapter ${text}`;
}

module.exports = { sleep, mapLimit, sanitizeFilename, chapterDisplayLabel };
