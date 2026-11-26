"use strict";

const config = require("../config");
const { UA } = require("./http");

let playwright = null;
let loadError = null;
try {
  playwright = require("playwright");
} catch (err) {
  loadError = err;
}

let browserPromise = null;
let lock = Promise.resolve();
let idleTimer = null;
let lastActive = 0;

/**
 * Async-mutexed section: concurrent tabs/jobs share one browser and render
 * pages one at a time to keep resource usage sane.
 */
async function withRenderLock(fn) {
  lastActive = Date.now();
  const run = lock.then(() => fn());
  lock = run.then(
    () => {},
    () => {},
  );
  return run;
}

// The browser keeps Node's event loop alive; close it after a stretch of
// inactivity so tests/scripts can exit and the server sheds memory between
// bursts. Reschedules on every use.
function scheduleIdleClose() {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    if (Date.now() - lastActive >= 60000) close();
  }, 60000);
  idleTimer.unref && idleTimer.unref();
}

async function launch() {
  if (!playwright) {
    const err = new Error("playwright is not installed — JS rendering disabled");
    err.code = "NO_PLAYWRIGHT";
    throw err;
  }
  return playwright.chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-blink-features=AutomationControlled"],
  });
}

function getBrowser() {
  if (!playwright) return Promise.reject(new Error("playwright not available"));
  if (!browserPromise) {
    browserPromise = launch().catch((err) => {
      browserPromise = null;
      throw err;
    });
  }
  scheduleIdleClose();
  return browserPromise;
}

/**
 * Render a page in headless Chromium and return the live-DOM image URLs in
 * document order. Auto-scrolls to trigger lazy loading, then settles.
 *
 * Returns { imgUrls: [], html, title, blocked: "turnstile"|null }.
 * If a Cloudflare Turnstile/widget is present after the grace window,
 * `blocked` is "captcha" so callers can report it clearly.
 */
async function renderPage(url, { title: pageTitle = null } = {}) {
  if (!playwright) {
    return { imgUrls: [], html: "", title: pageTitle, blocked: null };
  }
  return withRenderLock(async () => {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 900 },
      locale: "en-US",
    });
    const page = await context.newPage();
    try {
      await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: config.JS_RENDER_TIMEOUT_MS,
      });

      // Give client JS a beat to mount, then scroll to load lazy images.
      const scrolls = config.JS_RENDER_SCROLLS;
      await page.evaluate(async (n) => {
        const step = Math.max(window.innerHeight, 600);
        for (let i = 0; i < n; i++) {
          window.scrollBy(0, step);
          await new Promise((r) => setTimeout(r, 350));
        }
        window.scrollTo(0, 0);
      }, scrolls);

      await page.waitForTimeout(config.CAPTCHA_GRACE_MS);

      const title =
        pageTitle ||
        (await page.title().catch(() => null)) ||
        (await page
          .evaluate(() => {
            const t = document.querySelector('meta[property="og:title"]');
            return t ? t.content : null;
          })
          .catch(() => null));

      const imgUrls = await page
        .evaluate(() => {
          const attrs = [
            "currentSrc",
            "src",
            "data-src",
            "data-srcset",
            "data-lazy-src",
            "data-original",
          ];
          const out = [];
          const seen = new Set();
          const nodes = document.querySelectorAll("img");
          nodes.forEach((img) => {
            for (const a of attrs) {
              const raw = img[a];
              if (!raw) continue;
              if (a === "srcset" || a === "data-srcset") {
                const first = raw.split(",")[0].trim().split(/\s+/)[0];
                if (first) push(first);
              } else {
                push(raw);
              }
            }
          });
          function push(raw) {
            if (!raw || raw.startsWith("data:")) return;
            let u;
            try {
              u = new URL(raw, location.href);
            } catch {
              return;
            }
            if (!/^https?:$/.test(u.protocol)) return;
            if (/(avatar|logo|icon|emoji|spacer|advert|badge|banner|loading|thumb|cover)/i.test(u.pathname)) return;
            if (!/\.(webp|jpe?g|png|avif|gif)(\?.*)?$/i.test(u.pathname)) return;
            const clean = u.origin + u.pathname;
            if (seen.has(clean)) return;
            seen.add(clean);
            out.push(clean);
          }
          return out;
        })
        .catch(() => []);

      const html = await page.content().catch(() => "");
      const blocked = await detectTurnstile(page, url);

      return { imgUrls, html, title, blocked };
    } catch (err) {
      return { imgUrls: [], html: "", title: pageTitle, blocked: null, error: err.message };
    } finally {
      await context.close().catch(() => {});
    }
  });
}

/**
 * Detect an interactive Cloudflare Turnstile / challenge still running after
 * the grace window. Returns "captcha" or null.
 */
async function detectTurnstile(page, url) {
  try {
    const text = await page.evaluate(() => document.body && document.body.innerText.slice(0, 4000));
    const hasWidget =
      (await page
        .$(
          "iframe[src*='challenges.cloudflare.com'], [class*='turnstile'], .cf-turnstile, #challenge-running, #challenge-form",
        )
        .catch(() => null)) || false;
    const lower = (text || "").toLowerCase();
    const hasText =
      lower.includes("verify you are human") ||
      lower.includes("verify you are not a robot") ||
      lower.includes("complete the challenge");
    if (hasWidget || hasText) return "captcha";
  } catch {}
  return null;
}

/**
 * Download image bytes through the browser context (carries cookies/referer),
 * useful when a CDN hotlink-protects or signs URLs. Returns a Buffer or null.
 */
async function fetchViaBrowser(url, { referer } = {}) {
  if (!playwright) return null;
  return withRenderLock(async () => {
    const browser = await getBrowser();
    const context = await browser.newContext({
      userAgent: UA,
      viewport: { width: 1280, height: 900 },
    });
    const page = await context.newPage();
    try {
      const extra = referer ? { referer } : {};
      const res = await page.evaluate(
        async ({ u, r }) => {
          const resp = await fetch(u, { referrer: r || undefined });
          if (!resp.ok) return null;
          const buf = await resp.arrayBuffer();
          return Array.from(new Uint8Array(buf));
        },
        { u: url, r: referer || null },
      );
      if (!res) return null;
      return Buffer.from(res);
    } catch {
      return null;
    } finally {
      await context.close().catch(() => {});
    }
  });
}

async function close() {
  if (idleTimer) {
    clearTimeout(idleTimer);
    idleTimer = null;
  }
  if (browserPromise) {
    const b = await browserPromise.catch(() => null);
    if (b) await b.close().catch(() => {});
    browserPromise = null;
  }
}

module.exports = {
  renderPage,
  fetchViaBrowser,
  detectTurnstile,
  close,
  get available() {
    return !!playwright;
  },
  get loadError() {
    return loadError;
  },
};