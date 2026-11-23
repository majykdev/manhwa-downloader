"use strict";

function intEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const n = Number.parseInt(raw, 10);
  return Number.isFinite(n) ? n : fallback;
}

module.exports = {
  PORT: intEnv("PORT", 3000),
  NODE_ENV: process.env.NODE_ENV || "development",
  CHAPTER_DELAY_MS: intEnv("CHAPTER_DELAY_MS", 400),
  IMAGE_PARALLELISM: intEnv("IMAGE_PARALLELISM", 4),
  MAX_IMAGES_PER_CHAPTER: intEnv("MAX_IMAGES_PER_CHAPTER", 200),
  JOB_TTL_MS: intEnv("JOB_TTL_MS", 60 * 60 * 1000),
  PDF_MAX_PAGE_WIDTH: intEnv("PDF_MAX_PAGE_WIDTH", 800),
  PDF_JPEG_QUALITY: intEnv("PDF_JPEG_QUALITY", 85),
  JS_RENDER_ENABLED: process.env.JS_RENDER_ENABLED !== "false",
  JS_RENDER_TIMEOUT_MS: intEnv("JS_RENDER_TIMEOUT_MS", 30_000),
  JS_RENDER_SCROLLS: intEnv("JS_RENDER_SCROLLS", 10),
  TLS_IMPERSONATION_ENABLED: process.env.TLS_IMPERSONATION_ENABLED !== "false",
  CAPTCHA_GRACE_MS: intEnv("CAPTCHA_GRACE_MS", 8_000),
};
