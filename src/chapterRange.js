"use strict";

function parseChapterNumber(value, name) {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") {
    throw new Error(`${name} must be a whole chapter number.`);
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    throw new Error(`${name} must be a whole chapter number of 0 or greater.`);
  }
  return n;
}

function normalizeChapterRange(body = {}) {
  const startChapter = parseChapterNumber(body.startChapter, "Start chapter");
  const endChapter = parseChapterNumber(body.endChapter, "End chapter");
  if (startChapter !== null && endChapter !== null && startChapter > endChapter) {
    throw new Error("Start chapter cannot be greater than end chapter.");
  }
  return { startChapter, endChapter };
}

function logicalChapterNumber(number) {
  const n = Number(number);
  if (!Number.isFinite(n) || n < 0) return null;
  return Math.floor(n);
}

function inChapterRange(number, range = {}, { logical = false } = {}) {
  const raw = Number(number);
  if (!Number.isFinite(raw) || raw < 0) return false;
  const start = range.startChapter;
  const end = range.endChapter;
  if (!logical && !Number.isInteger(raw) && (start != null || end != null)) return false;
  const n = logical ? logicalChapterNumber(raw) : raw;
  if (n === null) return false;
  if (start !== null && start !== undefined && n < start) return false;
  if (end !== null && end !== undefined && n > end) return false;
  return true;
}

function filterByChapterRange(items, getNumber, range = {}, options = {}) {
  return (items || []).filter((item) => inChapterRange(getNumber(item), range, options));
}

module.exports = {
  normalizeChapterRange,
  logicalChapterNumber,
  inChapterRange,
  filterByChapterRange,
};
