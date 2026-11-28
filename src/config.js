"use strict";

const os = require("os");
const path = require("path");

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  PORT: intEnv("PORT", 3001),
  CHAPTER_DELAY_MS: intEnv("CHAPTER_DELAY_MS", 400),
  IMAGE_PARALLELISM: intEnv("IMAGE_PARALLELISM", 4),
  MAX_IMAGES_PER_CHAPTER: intEnv("MAX_IMAGES_PER_CHAPTER", 200),
  JOB_TTL_MS: intEnv("JOB_TTL_MS", 60 * 60 * 1000),
  PDF_MAX_PAGE_WIDTH: intEnv("PDF_MAX_PAGE_WIDTH", 390),
  PDF_CHAPTER_PAGE_SIZE_MODE:
    process.env.PDF_CHAPTER_PAGE_SIZE_MODE === "first" ? "first" : "natural",
  PDF_JPEG_QUALITY: intEnv("PDF_JPEG_QUALITY", 85),
  PREPARED_JPEG_QUALITY: intEnv("PREPARED_JPEG_QUALITY", 95),
  JS_RENDER_ENABLED: process.env.JS_RENDER_ENABLED !== "false",
  JS_RENDER_TIMEOUT_MS: intEnv("JS_RENDER_TIMEOUT_MS", 30_000),
  JS_RENDER_SCROLLS: intEnv("JS_RENDER_SCROLLS", 10),
  TLS_IMPERSONATION_ENABLED: process.env.TLS_IMPERSONATION_ENABLED !== "false",
  CAPTCHA_GRACE_MS: intEnv("CAPTCHA_GRACE_MS", 8_000),
  DATA_DIR:
    process.env.MANHWA_DOWNLOADER_DATA_DIR || path.join(os.homedir(), ".manhwa-downloader"),
  COVER_UPLOAD_MAX_BYTES: intEnv("COVER_UPLOAD_MAX_BYTES", 5 * 1024 * 1024),
  API_JSON_LIMIT: process.env.API_JSON_LIMIT || "8mb",
};
