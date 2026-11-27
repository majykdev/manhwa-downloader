# Manhwa Downloader

Current release: **v1.0.1 beta 3** (`1.0.1-beta.3`).

A deployable web app that turns a manga/manhwa series into a single PDF. Asura
Scans uses a fast numeric path, atsu.moe uses its public JSON API with selectable
scanlation sources, and other sites use a generic scraper.

Paste a series or chapter URL (for example
`https://asurascans.com/comics/trash-of-the-counts-family-7e1f454a/chapter/0` or
`https://atsu.moe/manga/Baxr`) and click **Find chapters**. Every discovered
chapter is shown for review before export, and each row can be edited or
replaced with a URL from another supported site. Additional chapters can be
added manually.

Everything is fetched server-side: the browser only talks to your app and
downloads the finished PDF, so source-site images do not cross the user's
connection and there are no browser CORS issues.

## Requirements

- macOS for the included double-clickable `.command` scripts. On other platforms,
  use the manual Node commands below.
- Git to clone and update the project.
- Homebrew is recommended on macOS to install Git and Node. `setup.command` can
  also install Node locally under `~/.local/node` when Homebrew is unavailable
  or not writable.
- Node 20 or newer.

### Install Homebrew and Git

If you already have Homebrew and Git, skip this section.

Install Homebrew:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

Homebrew prints PATH commands at the end of the installer. Run the one it shows,
or run the appropriate line for your Mac:

```bash
# Apple Silicon
eval "$(/opt/homebrew/bin/brew shellenv)"

# Intel
eval "$(/usr/local/bin/brew shellenv)"
```

Install Git:

```bash
brew install git
```

Verify:

```bash
git --version
brew --version
```

## Install

Clone the GitHub repository and run the setup and deploy scripts:

```bash
git clone https://github.com/majykdev/manhwa-downloader.git
cd manhwa-downloader
chmod +x ./*.command
./setup.command
./deploy.command
```

On macOS you can double-click the `.command` files instead of running them in a
terminal. Run `setup.command` once on a fresh checkout; run `deploy.command`
whenever you want to start or restart the local server.

The app will be available at <http://localhost:3001>.

## The three `.command` files

| Script | When to run it | What it does |
| --- | --- | --- |
| `setup.command` | Once on a fresh install | Finds Homebrew or installs Node locally to `~/.local/node`, ensures Node 20+, runs `npm ci`, installs Playwright Chromium, and runs the test suite before reporting setup complete. |
| `update.command` | Before updating an existing checkout | Requires Git, npm, a clean working tree, a Git checkout, and an `origin` remote. It runs `git fetch --prune origin`, fast-forwards the current branch with `git pull --ff-only origin <branch>`, and reruns `npm ci --no-audit --no-fund` only if `node_modules` is missing or `package-lock.json` changed. It does not start the server. |
| `deploy.command` | After setup, and after an update when you want to restart | Ensures Node 20+ and `node_modules` exist, stops any process listening on port `3001`, starts the server in the background, waits for `/health`, writes the PID to `/tmp/manhwa-downloader-3001.pid`, writes logs to `/tmp/manhwa-downloader-3001.log`, and opens the browser unless `NO_OPEN=1` is set. |

For manual, cross-platform use:

```bash
npm ci
npm start          # http://localhost:3001
npm run dev        # auto-reload
npm test           # offline tests against saved HTML fixtures
```

## Features

<details>
<summary><strong>Source support</strong></summary>

<details>
<summary>Site auto-detection</summary>

Auto-detects Asura Scans, atsu.moe, and generic sites from the URL hostname; there is no provider toggle.
</details>

<details>
<summary>Asura cover URLs</summary>

Asura links use the numeric chapter path and full-size viewer cover image, with `-400` thumbnail suffixes normalized before export.
</details>

<details>
<summary>Atsu JSON API</summary>

atsu.moe uses the public JSON API for manga info, chapter lists, providers, and reader pages.
</details>

<details>
<summary>Generic scraper</summary>

Other sites use the generic scraper, with source metadata, JSON-LD, and cover-like images used for discovery.
</details>

<details>
<summary>Fallback renderers</summary>

Static HTML is tried first; JS-heavy or protected pages fall back to Playwright rendering and, when needed, an optional TLS/HTTP2 impersonation client.
</details>

<details>
<summary>Server-side fetch</summary>

Server-side fetching avoids browser CORS issues and keeps source images off the user's connection.
</details>

</details>

<details>
<summary><strong>Review before export</strong></summary>

<details>
<summary>Preview tokens</summary>

Discovery returns a short-lived token and a complete chapter preview; no job starts automatically.
</details>

<details>
<summary>Editable chapters</summary>

Chapter rows can be edited to custom URLs, and each custom URL is detected as Asura, Atsu, or generic independently of the original series.
</details>

<details>
<summary>Added chapters</summary>

Extra chapters can be added manually with numbers inferred from their URLs when possible, then inserted in numeric order.
</details>

<details>
<summary>Provider selection</summary>

For atsu.moe, providers can be enabled/disabled and reordered, with per-chapter and per-part overrides. Missing selected parts fall back automatically to any available provider.
</details>

<details>
<summary>Chapter coverage</summary>

Coverage is checked against chapter links and JSON-LD `numberOfEpisodes` or the page's `rel=next` chain, so 0-based and 1-based series both end at the newest chapter.
</details>

<details>
<summary>Prologue handling</summary>

Chapter 0 is an optional prologue: it is probed and included with a `Prologue` spacer when present, excluded from chapter counts, and skipped when a manual start is `>= 1`.
</details>

<details>
<summary>Decimal parts</summary>

Decimal Atsu parts such as `37.1` and `37.2` are combined with chapter `37` into one logical chapter, including when a part is missing.
</details>

<details>
<summary>Locked chapters</summary>

Premium or locked chapters with no page images are skipped and reported in the progress log while keeping the spacer so numbering stays consistent.
</details>

</details>

<details>
<summary><strong>Settings and shared throttling</strong></summary>

<details>
<summary>Chapter bounds</summary>

Start/end chapter bounds are chapter numbers, not array indexes; blank bounds mean first/last, and an end above the last chapter exports through the end.
</details>

<details>
<summary>Apply-only settings</summary>

Settings are per job/draft, not global. **Apply** commits them to the active draft and shows a green `✓ Applied!` state until the settings change or the panel is reopened.
</details>

<details>
<summary>Per-job settings</summary>

New jobs and refreshed sessions start from defaults; applied values stay with their draft, job, or archived record.
</details>

<details>
<summary>Hyperlinks toggle</summary>

**Chapter Hyperlinks** is enabled by default; turning it off keeps PDF table-of-contents labels but removes clickable links.
</details>

<details>
<summary>Throttle profiles</summary>

Shared throttle profiles are **Safe**, **Balanced**, and **Fast**, with app-wide page limits and per-host image buckets so concurrent jobs do not hammer the same site.
</details>

<details>
<summary>Adaptive speed</summary>

Speed can be Auto or manual. Auto starts conservatively, steps down on rate limits and retries, and slowly recovers; manual high concurrency falls back when throttled.
</details>

<details>
<summary>Pause and resume</summary>

Running jobs can be paused and resumed. Rate limits, retries, and cooldown state are reflected in the Jobs panel.
</details>

</details>

<details>
<summary><strong>Jobs, drafts, and archive</strong></summary>

<details>
<summary>Parallel jobs</summary>

Multiple jobs can be created with the `+` button and run in parallel; job rows show status, progress, and the absolute current/max chapter.
</details>

<details>
<summary>Refresh persistence</summary>

Active jobs and editable drafts persist across browser refreshes through `sessionStorage`, and background jobs continue running.
</details>

<details>
<summary>Running progress</summary>

The progress bar appears only while a job is actively exporting.
</details>

<details>
<summary>Archive actions</summary>

The `×` action pauses a running job before archiving it, or archives a finished/failed job directly; archiving the last job automatically creates a new blank draft.
</details>

<details>
<summary>Auto archive</summary>

Downloading the final PDF from a job also archives it.
</details>

<details>
<summary>Archive storage</summary>

The Archive section is collapsed by default and stores records in `localStorage`.
</details>

<details>
<summary>Download window</summary>

Valid archives have a one-hour download window; expired archives offer **Rerun**.
</details>

<details>
<summary>Reload archive</summary>

Clicking an archived job loads a fresh editable draft into the main card with its URL, settings, reviewed chapters, sources, cover, and saved progress details.
</details>

<details>
<summary>Delete modal</summary>

Archive deletion uses a custom Cancel/Delete confirmation modal.
</details>

<details>
<summary>Debug log</summary>

The debug log shows server errors and chapter failures, streamed over Server-Sent Events with polling and `GET /api/debug/log` as fallbacks.
</details>

</details>

<details>
<summary><strong>Covers and PDF output</strong></summary>

<details>
<summary>Custom covers</summary>

A user-supplied cover URL always wins over auto-detection.
</details>

<details>
<summary>Detected covers</summary>

Detected covers come from Asura/Atsu selectors or generic metadata; a found cover is rendered as PDF page 1, while a missing or failed cover falls back to a PDF without it.
</details>

<details>
<summary>Streaming PDF</summary>

The PDF is written with `pdfkit` directly to disk, keeping only prepared images in memory so large books do not exhaust the process.
</details>

<details>
<summary>Chapter spacers</summary>

Each chapter is preceded by a centered two-line spacer page, such as `Chapter 37` and `Chapters 37.1 + 37.2`, with text capped at 28pt/12pt and divider width matching the image width.
</details>

<details>
<summary>Page sizing</summary>

PDF pages use phone-friendly dimensions by default, with `natural` or `first` chapter page-size modes and configurable JPEG quality.
</details>

<details>
<summary>Partial PDF</summary>

While a job is running, `/api/jobs/:id/download` builds a partial PDF from completed chapters and pauses scraping until the response finishes. The final download is the complete PDF.
</details>

<details>
<summary>TTL cleanup</summary>

Finished jobs, PDFs, and temporary images are deleted after `JOB_TTL_MS` (default one hour).
</details>

</details>

## Quick update

```bash
cd manhwa-downloader
git status --short
./update.command
./deploy.command
```

`update.command` refuses to run if the checkout has uncommitted changes. Commit,
stash, or discard local changes first. It updates the code and dependencies only;
run `deploy.command` afterward to restart the local server with the new version.

## Deploy

Local macOS deploy is handled by `deploy.command`:

```bash
./deploy.command
```

Use `NO_OPEN=1 ./deploy.command` when you do not want it to open a browser, such
as in automation. The script checks `/health` before reporting success.

For a generic Node host, set environment variables and run:

```bash
npm ci
PORT=3001 npm start
```

`npm run dev` is suitable for local development with auto-reload. Any Node 20+
host should work. The included `Dockerfile` builds the app with Chromium for the
Playwright fallback:

```bash
docker build -t manhwa-downloader .
docker run -p 3001:3001 manhwa-downloader
```

The app is single-instance by design because jobs live in memory. Use one web
process; move `JobStore` to a shared store before scaling horizontally.

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/discover` | Body `{ "url": "...", "startChapter": 37, "endChapter": null, "settings": { ... } }` → detected kind, short-lived `discoveryToken`, chapter preview, cover URL, and Atsu provider options. |
| `POST` | `/api/scrape` | Body `{ "discoveryToken": "...", "chapterUrlOverrides": {}, "addedChapters": [{ "number": 58, "url": "..." }], "coverUrl": "...", "sourceOrder": [], "enabledSourceIds": [], "chapterOverrides": {}, "settings": { ... } }` → `{ "jobId" }`. Also accepts the legacy direct-url body. Responds `422 NEED_FIRST_CHAPTER` when no chapter list is found and `400` when no chapter matches the range. |
| `POST` | `/api/jobs/:id/retry` | Re-scrapes chapters that failed only at image download and rebuilds the PDF. |
| `POST` | `/api/jobs/:id/pause` | Pauses a running job and returns a paused snapshot. |
| `POST` | `/api/jobs/:id/resume` | Resumes a paused job. |
| `GET` | `/api/jobs/:id` | Job snapshot: phase, status, chapter progress, completed count, pages, skips, log, speed/throttle state, and download URL. |
| `GET` | `/api/jobs/:id/events` | SSE stream of job snapshots. |
| `GET` | `/api/jobs/:id/download` | Streams the complete PDF; while running, builds a partial PDF from chapters already done. |
| `GET` | `/api/debug/log` | Recent structured debug entries for the UI debug window. |
| `GET` | `/api/debug/events` | SSE stream of new debug entries. |
| `GET` | `/health` | Health check for platform probes and `deploy.command`. |

## Configuration

Environment variables are documented in `.env.example`; set them in your shell
or deployment platform's environment. Key knobs:

- `PORT` (3001) — HTTP port.
- `CHAPTER_DELAY_MS` (400) — delay between chapter requests; raise it to be friendlier to source sites.
- `IMAGE_PARALLELISM` (4) — concurrent image downloads within a chapter.
- `MAX_IMAGES_PER_CHAPTER` (200) — hard cap on page images scraped per chapter.
- `PDF_MAX_PAGE_WIDTH` (390) — PDF page width in points; phone-friendly by default, with height following the image aspect ratio.
- `PDF_CHAPTER_PAGE_SIZE_MODE` (`natural`) — `natural` keeps each image's aspect ratio; `first` normalizes every page in a chapter to the first image page's size.
- `PDF_JPEG_QUALITY` (85) — JPEG quality for embedded page images, from 0 to 100.
- `JOB_TTL_MS` (3600000) — how long finished jobs, PDFs, and temporary files are kept before deletion.
- `JS_RENDER_ENABLED` (true), `JS_RENDER_TIMEOUT_MS` (30000), `JS_RENDER_SCROLLS` (10) — Playwright fallback for JS-driven pages.
- `TLS_IMPERSONATION_ENABLED` (true), `CAPTCHA_GRACE_MS` (8000) — TLS/HTTP2 impersonation fallback and captcha detection grace period.

## Notes

- Scraping public sites can trigger rate limits or Cloudflare blocks. The client retries with exponential backoff, and jobs adapt concurrency and delay after 403/429/503/520 responses, timeouts, and challenge pages. Use Auto speed or raise `CHAPTER_DELAY_MS` if blocks persist.
- Keep only one instance running unless you replace the in-memory `JobStore` with a shared store.
- Use the app responsibly: respect source-site terms and only download content you have the right to keep.
