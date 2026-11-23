"use strict";

const axios = require("axios");
const config = require("../config");
const { tlsFetch, isCloudflareBlock } = require("./tls");

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const client = axios.create({
  timeout: 60_000,
  maxRedirects: 5,
  headers: {
    "User-Agent": UA,
    Accept:
      "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "identity",
    "Cache-Control": "no-cache",
  },
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * GET with retries + exponential backoff. Returns { status, data, headers }.
 * On 403/429 (Cloudflare) it backs off longer; on 404 it retries a couple of
 * times before giving up (pages can 404 transiently during deploys).
 */
async function fetchWithRetry(url, { attempts = 4, baseDelay = 800, onRetry, config: reqConfig = {} } = {}) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await client.get(url, reqConfig);
      return { status: res.status, data: res.data, headers: res.headers };
    } catch (err) {
      lastErr = err;
      const status = err.response ? err.response.status : null;
      if (status === 404) {
        await sleep(baseDelay);
        continue;
      }
      // Cloudflare soft-blocks: treat as retryable with a longer backoff.
      if (status === 403 || status === 429 || status === 503 || status === 520) {
        const wait = baseDelay * 2 ** (i + 1) + Math.random() * 500;
        if (onRetry) onRetry(url, status, wait);
        await sleep(wait);
        continue;
      }
      if (err.code === "ECONNRESET" || err.code === "ETIMEDOUT" || err.code === "ECONNABORTED") {
        const wait = baseDelay * 2 ** i + Math.random() * 300;
        if (onRetry) onRetry(url, err.code, wait);
        await sleep(wait);
        continue;
      }
      throw err;
    }
  }
  const status = lastErr.response ? lastErr.response.status : lastErr.code || "UNKNOWN";
  const err = new Error(`Request failed for ${url} (${status})`);
  err.status = status;
  err.cause = lastErr;
  throw err;
}

async function downloadBuffer(url, { onRetry } = {}) {
  // responseType: "arraybuffer" keeps binary bytes intact (default decodes as
  // a utf-8 string, which corrupts WebP/JPEG payloads).
  const res = await fetchWithRetry(url, {
    attempts: 3,
    baseDelay: 600,
    onRetry,
    config: { responseType: "arraybuffer" },
  });
  return Buffer.from(res.data);
}

/**
 * Smart GET ladder: axios first, then TLS impersonation when Cloudflare blocks,
 * then (optionally) a headless-browser render. Returns { status, data, headers,
 * cloudflareBlock, rendered }. Used by chapter fetchers that need real content
 * that JS-rendered sites only produce after executing client scripts.
 */
async function fetchPageSmart(url, { attempts = 2, referer } = {}) {
  let res;
  try {
    res = await fetchWithRetry(url, {
      attempts,
      config: {
        ...(referer ? { headers: { Referer: referer } } : {}),
      },
    });
  } catch (err) {
    return { error: err.status || err.code || err.message || "error", status: err.status };
  }

  const bodyText = typeof res.data === "string" ? res.data : "";
  if (isCloudflareBlock(bodyText, res.status, res.headers) || res.status === 403) {
    const tls = await tlsFetch(url, { referer });
    if (tls && tls.status === 200 && !tls.cloudflareBlock && tls.data.length > 0) {
      return { status: 200, data: tls.data, headers: tls.headers, viaTLS: true };
    }
    return { status: res.status, data: Buffer.from(""), headers: res.headers, cloudflareBlock: true };
  }

  if (typeof res.data === "string") {
    return { status: res.status, data: res.data, headers: res.headers };
  }
  return { status: res.status, data: Buffer.from(res.data), headers: res.headers };
}

module.exports = { client, sleep, fetchWithRetry, downloadBuffer, fetchPageSmart, UA };
