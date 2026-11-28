"use strict";

const MAX_ENTRIES = 200;

const entries = [];
const listeners = new Set();
let seq = 0;

function debugLog(level, message) {
  const entry = { id: ++seq, at: Date.now(), level, message: String(message) };
  entries.push(entry);
  if (entries.length > MAX_ENTRIES) entries.shift();
  for (const listener of listeners) {
    try {
      listener(entry);
    } catch {}
  }
}

function subscribe(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getDebugLog() {
  return entries.slice();
}

function debugChapterDownloaded(jobId, label, pages, provider) {
  const source = provider ? ` (${provider})` : "";
  debugLog("info", `Job ${jobId} downloaded chapter ${label}${source} — ${pages} pages`);
}

function debugPdfDownloaded(jobId, title, filename) {
  debugLog("info", `Job ${jobId} PDF downloaded by user: ${title} → ${filename}`);
}

function debugCbzDownloaded(jobId, title, filename) {
  debugLog("info", `Job ${jobId} CBZ downloaded by user: ${title} → ${filename}`);
}

function debugScrapeComplete(jobId, title, pages, chapters) {
  debugLog(
    "info",
    `Job ${jobId} scrape complete: ${title} — ${pages} pages across ${chapters} chapters`,
  );
}

module.exports = {
  debugLog,
  subscribe,
  getDebugLog,
  debugChapterDownloaded,
  debugPdfDownloaded,
  debugCbzDownloaded,
  debugScrapeComplete,
};
