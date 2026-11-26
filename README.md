# Manhwa Downloader

Current release: **v0.9.1 beta 1** (`0.9.1-beta.1`).

A deployable web app that turns a manga/manhwa series into a single PDF. Asura
Scans uses a fast numeric path, atsu.moe uses its public JSON API with selectable
scanlation sources, and other scanlation sites use a generic scraper.

Paste a series or chapter URL (e.g. `https://asurascans.com/comics/trash-of-the-counts-family-7e1f454a/chapter/0` or `https://atsu.moe/manga/Baxr`). The server:

1. strips chapter segments to find the series/title page, discovers how many chapters exist, and finds the cover image,
2. scrapes the chapter range you choose in Settings (blank bounds mean first/last),
3. downloads all page images (WebP → JPEG) with adaptive concurrency/delay,
4. renders everything into one streaming PDF with the **cover as the first page** and a **two-line spacer page between chapters** (e.g. `Chapter 37` / `Chapters 37.1 + 37.2` for Atsu split parts),
5. streams the finished PDF back to you, with an on-demand partial PDF available while scraping.

Everything runs **server-side** — the browser only ever talks to your app and downloads one finished PDF, so the source site's images never cross the user's connection (minimal bandwidth, no CORS issues).

## Run locally

```bash
npm install
npm start          # http://localhost:3001
```

`npm run dev` runs with auto-reload. `npm test` runs offline tests against real saved HTML fixtures (no network).

## Deploy

Any Node host works. Set `PORT` via env. On macOS, double-click `deploy.command` to start the local server on port 3001.

To update an existing checkout to the latest GitHub `main`, double-click `update.command`. It fast-forwards the folder, refreshes dependencies only when needed, and refuses to run if you have uncommitted local changes.
## How it works

- The source site is auto-detected from the hostname — there is no provider toggle. Asura links use the numeric path, `atsu.moe` links use the Atsu adapter, everything else falls back to the generic scraper.
- Static HTML is tried first (Asura chapter pages contain plain `<img>` tags pointing at the image CDN). For JS-heavy or Cloudflare-protected sites the server falls back to a Playwright-rendered page and, when needed, an optional TLS/HTTP2 impersonation client.
- Atsu chapters come from `GET /api/manga/page` and `GET /api/manga/allChapters`; pages come from `GET /api/read/chapter` and `https://cdn.atsu.moe`. Multiple providers for the same chapter number are grouped. Decimal parts such as `37.1`/`37.2` are combined with chapter `37` into one logical chapter (even when one part is missing) and are rendered with a two-line spacer; no completeness warning is shown for split parts.
- Before starting an Atsu job the UI lets you enable/disable providers, reorder provider priority (chapter order stays numeric), and override the provider for an individual chapter or decimal part. If your selected providers do not cover a part, any remaining provider is used automatically; a chapter is only omitted when no source has any part.
- The Settings gear exposes start/end chapter bounds plus custom concurrency and delay dropdowns. Bounds are chapter numbers (start `37` is chapter 37, not index 37); start `0` falls back to chapter 1 when there is no prologue, and a start >= 1 skips the prologue. An end above the last chapter exports everything from the start.
- Auto speed starts at concurrency 4 / 400 ms, steps down on rate limits and retries, and slowly ramps the delay back up after sustained success. Manual high concurrency falls back to 1 chapter at a time when throttled. Settings are saved in `localStorage` only when **Apply** is clicked and sent with each job.
- The numbered chapter range comes from the series page's chapter links, corrected against JSON-LD `numberOfEpisodes` (e.g. `186`), so both 0-based and 1-based series end on the newest chapter. If neither source exists it follows each page's `<link rel="next">`.
- Chapter 0 is treated as an optional prologue: it is probed on every job and included (with a `Prologue` spacer) when it exists, but it is not counted in chapter numbers or totals. A missing chapter 0 is ignored without being reported as a skip. A manual start >= 1 skips the prologue probe entirely.
- Premium/locked chapters (no page images + paywall markers) are skipped and reported in the progress log; the spacer still appears so chapter numbering in the PDF stays consistent.
- The cover comes from the series/title page: Asura and Atsu use their specific cover selectors, while other sites use metadata/JSON-LD and cover-like images after chapter URL segments are removed. A found cover is rendered as PDF page 1; if it cannot be found or downloaded, the PDF is still built without it.
- The PDF is written with `pdfkit` straight to disk, one prepared JPEG in memory at a time, so multi-thousand-page books won't exhaust the process memory. Finished jobs, their PDFs, and their temporary chapter images are all deleted after `JOB_TTL_MS` (default 1 h).
- While a job is running, `/api/jobs/:id/download` builds a partial PDF on demand from chapters already marked done and pauses scraping until the response finishes. The final download is the complete PDF.
- The UI has a small debug log at the bottom that shows server errors and chapter-pull failures. Job progress and debug entries are streamed over Server-Sent Events, with polling and `GET /api/debug/log` as fallbacks.

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/discover` | Body `{ "url": "...", "startChapter": 37, "endChapter": null, "settings": { "concurrency": "auto", "delay": "auto" } }` → detected kind. For Atsu, returns a short-lived `discoveryToken` plus providers/chapter options for logical chapters and decimal parts. |
| `POST` | `/api/scrape` | Body `{ "url": "...", "firstChapterUrl": "...", "startChapter": null, "endChapter": null, "settings": {...} }` → `{ "jobId" }`, or `{ "discoveryToken": "...", "sourceOrder": [], "enabledSourceIds": [], "chapterOverrides": {} }`. Starts the job. Responds `422 NEED_FIRST_CHAPTER` when no chapter list is found and `400` when no chapter matches the range. |
| `POST` | `/api/jobs/:id/retry` | Re-scrapes chapters that failed only at image download and rebuilds the PDF. |
| `GET` | `/api/jobs/:id` | Job progress: phase, status, current/last chapter, completed count, pages, skips, log IDs, speed state, and download URL. |
| `GET` | `/api/jobs/:id/events` | SSE stream of job snapshots. |
| `GET` | `/api/jobs/:id/download` | Streams the complete PDF; while running, builds and streams a partial PDF from chapters already done. |
| `GET` | `/api/debug/log` | Recent structured debug entries for the UI debug window. |
| `GET` | `/api/debug/events` | SSE stream of new debug entries. |
| `GET` | `/health` | Health check for platform probes. |

## Configuration

See `.env.example`. Key knobs:

- `CHAPTER_DELAY_MS` (400) — delay between chapter requests; raise it to be friendlier to the source site.
- `IMAGE_PARALLELISM` (4) — concurrent image downloads within a chapter.
- `MAX_IMAGES_PER_CHAPTER` (200) — hard cap on pages scraped per chapter.
- `PDF_MAX_PAGE_WIDTH` (390) — PDF page width in points; phone-friendly by default, with height following the image's aspect ratio.
- `PDF_CHAPTER_PAGE_SIZE_MODE` (`natural`) — `natural` keeps each image's aspect ratio; `first` normalizes every page in a chapter to the first image page's size.
- `JOB_TTL_MS` (3600000) — how long finished jobs, PDFs, and temp files are kept before deletion.
- `JS_RENDER_ENABLED` (true), `JS_RENDER_TIMEOUT_MS` (30000), `JS_RENDER_SCROLLS` (10) — Playwright fallback for JS-driven pages.
- `TLS_IMPERSONATION_ENABLED` (true), `CAPTCHA_GRACE_MS` (8000) — TLS/HTTP2 impersonation fallback and captcha detection grace period.

## Notes

- **Single instance only.** Jobs live in memory. The web process runs them in the background and streams progress over SSE with polling fallback, which fits Render/Railway/Fly free/starter tiers. Swap the in-memory `JobStore` for Redis before scaling to multiple instances.
- Scraping public sites can trigger rate limits or Cloudflare blocks. The client retries with exponential backoff and the job adapts concurrency/delay on 403/429/503/520, timeouts, and Cloudflare challenges. If you hit persistent blocks, use Auto speed or raise `CHAPTER_DELAY_MS`.
- Use responsibly: respect the source site's terms and only download content you have the right to keep.
