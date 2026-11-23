"use strict";

const config = require("../config");

// wreq-js is a native binary; load lazily so the app still boots if it's
// missing or fails to load on an unsupported platform.
let wreq = null;
let loadError = null;
try {
  wreq = require("wreq-js");
} catch (err) {
  loadError = err;
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const ACCEPT =
  "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8";

// Persistent session reuses cookies (cf_clearance etc.) across requests.
let sessionPromise = null;

function getSession() {
  if (!sessionPromise) {
    sessionPromise = wreq
      .createSession({ impersonate: "chrome" })
      .catch((err) => {
        sessionPromise = null;
        throw err;
      });
  }
  return sessionPromise;
}

function headersToObj(headers) {
  const out = {};
  if (!headers) return out;
  try {
    const entries =
      typeof headers.entries === "function" ? headers.entries() : headers;
    for (const [k, v] of entries) out[k] = v;
  } catch {}
  return out;
}

/**
 * GET with browser TLS/HTTP2 fingerprint impersonation. Returns
 * { status, data, headers } so it plugs into the rest of the fetch ladder.
 * On Cloudflare TLS blocks this is the cheap fix before any browser is needed.
 * Resolves to null when wreq-js is unavailable or the attempt fails cleanly.
 */
async function tlsFetch(url, { referer } = {}) {
  if (!config.TLS_IMPERSONATION_ENABLED || !wreq) return null;
  try {
    const session = await getSession();
    const res = await session.fetch(url, {
      headers: {
        "User-Agent": UA,
        Accept: ACCEPT,
        "Accept-Language": "en-US,en;q=0.9",
        ...(referer ? { Referer: referer } : {}),
      },
    });
    const status = res ? res.status : null;
    const headers = res ? headersToObj(res.headers) : {};
    let data = Buffer.from("");
    try {
      const buf = await res.arrayBuffer();
      if (buf) data = Buffer.from(buf);
    } catch {}
    const bodyText = data.toString("utf8");
    if (isCloudflareBlock(bodyText, status)) {
      return { status, data: Buffer.from(""), headers, cloudflareBlock: true };
    }
    return { status, data, headers };
  } catch (err) {
    return null;
  }
}

const CF_MARKERS = [
  "cf-mitigated",
  "cf_chl_",
  "challenge-platform",
  "just a moment",
  "checking your browser",
  "cf-error-details",
  "cf-ray",
  "__cf_chl",
  "cf_chl_opt",
  "turnstile",
];

/**
 * Heuristic Cloudflare/Turnstile detection on { status, data, headers }.
 */
function isCloudflareBlock(bodyText, status, headers = {}) {
  if (status === 403 || status === 429 || status === 503) {
    const lower = (bodyText || "").toLowerCase();
    if (CF_MARKERS.some((m) => lower.includes(m))) return true;
  }
  const server = (headers["server"] || "").toLowerCase();
  if (server === "cloudflare" && (status === 403 || status === 503)) {
    const lower = (bodyText || "").toLowerCase();
    if (CF_MARKERS.some((m) => lower.includes(m))) return true;
  }
  return false;
}

module.exports = {
  tlsFetch,
  isCloudflareBlock,
  get wreqAvailable() {
    return !!(config.TLS_IMPERSONATION_ENABLED && wreq);
  },
  get loadError() {
    return loadError;
  },
};