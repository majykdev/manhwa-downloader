# Asura Scans → PDF

A deployable web app that turns any Asura Scans comic into a single PDF.

Paste a series or chapter URL (e.g. `https://asurascans.com/comics/trash-of-the-counts-family-7e1f454a/chapter/0`). The server:

1. strips `/chapter/N` to find the series page and discovers how many chapters exist,
2. scrapes every chapter from your start chapter to the last one,
3. downloads all page images (WebP → JPEG),
4. renders everything into one streaming PDF with a **spacer page between chapters** that says the next chapter's number (e.g. `Chapter 1`),
5. streams the finished PDF back to you.

Everything runs **server-side** — the browser only ever talks to your app and downloads one finished PDF, so the source site's images never cross the user's connection (minimal bandwidth, no CORS issues).

## Run locally

```bash
npm install
npm start          # http://localhost:3000
```

`npm run dev` runs with auto-reload. `npm test` runs offline tests against real saved HTML fixtures (no network).

## Deploy

Any Node host works. Set `PORT` via env.

**Render** — `render.yaml` is included (web service, health check at `/health`). Push the repo and create a new Web Service from it.

**Railway** — new project → deploy from repo. Railway sets `PORT` automatically; no config needed.

**Fly.io**
```bash
fly launch        # uses the included fly.toml + Dockerfile
fly deploy
```

**Docker** — the included `Dockerfile` (`node:20-slim`) builds a self-contained image; `sharp` ships prebuilt binaries so no compiler is needed at build time.

## How it works

- Chapter pages are fully server-rendered: all page images are plain `<img>` tags pointing at `cdn.asurascans.com/asura-images/chapters/...`. No JS execution or hidden API is required.
- The chapter count comes from the series page's JSON-LD `numberOfEpisodes` (e.g. `186`). If that's missing it falls back to counting chapter links, then to following each page's `<link rel="next">`.
- Premium/locked chapters (no page images + paywall markers) are skipped and reported in the progress log; the spacer still appears so chapter numbering in the PDF stays consistent.
- The PDF is written with `pdfkit` straight to disk, one image in memory at a time, so multi-thousand-page books won't exhaust the process memory. Finished PDFs are cleaned up after `JOB_TTL_MS` (default 1 h).

## API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/scrape` | Body `{ "url": "..." }` → `{ "jobId" }`. Starts the job. |
| `GET` | `/api/jobs/:id` | Job progress: status, current/last chapter, pages, skips, log. |
| `GET` | `/api/jobs/:id/download` | Streams the finished PDF (`Content-Disposition: attachment`). |
| `GET` | `/health` | Health check for platform probes. |

## Configuration

See `.env.example`. Key knobs:

- `CHAPTER_DELAY_MS` (400) — delay between chapter requests; raise it to be friendlier to the source site.
- `IMAGE_PARALLELISM` (4) — concurrent image downloads within a chapter.
- `PDF_MAX_PAGE_WIDTH` (800) — PDF page width in points; height follows the image's aspect ratio.
- `JOB_TTL_MS` (3600000) — how long finished PDFs are kept before deletion.

## Notes

- **Single instance only.** Jobs live in memory. The web process runs them in the background and clients poll for progress, which fits Render/Railway/Fly free/starter tiers. Swap the in-memory `JobStore` for Redis before scaling to multiple instances.
- Scraping public sites can trigger rate limits or Cloudflare blocks. The client retries with exponential backoff and backs off harder on 403/429. If you hit persistent blocks, raise `CHAPTER_DELAY_MS`.
- Use responsibly: respect the source site's terms and only download content you have the right to keep.
