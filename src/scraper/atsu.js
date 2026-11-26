"use strict";

const { fetchWithRetry, fetchPageSmart } = require("./http");
const { inChapterRange } = require("../chapterRange");

const ATSU_ORIGIN = "https://atsu.moe";
const CDN_ORIGIN = "https://cdn.atsu.moe";
const ID_PATTERN = /^[A-Za-z0-9_-]+$/;

async function getJson(path) {
  const url = new URL(path, ATSU_ORIGIN).href;
  const res = await fetchWithRetry(url, {
    attempts: 3,
    config: { headers: { Accept: "application/json" } },
  });
  let data = res.data;
  if (Buffer.isBuffer(data)) data = data.toString("utf8");
  if (typeof data === "string") data = JSON.parse(data);
  return data || {};
}

function chapterNumber(chapter) {
  const n = Number(chapter.number);
  if (Number.isFinite(n)) return n;
  if (Number.isFinite(Number(chapter.index))) return Number(chapter.index) + 1;
  return null;
}

function normaliseImage(image) {
  if (typeof image !== "string" || image.length === 0) return null;
  if (/^https?:\/\//i.test(image)) return image;
  if (image.startsWith("/static/")) return CDN_ORIGIN + image;
  if (image.startsWith("static/")) return `${CDN_ORIGIN}/${image}`;
  return new URL(image, ATSU_ORIGIN).href;
}

function readerUrl(mangaId, chapterId, medium) {
  const base = medium === "Novel" ? "novel" : "read";
  return `${ATSU_ORIGIN}/${base}/${mangaId}/${chapterId}`;
}

function parseReaderUrl(raw) {
  try {
    const url = new URL(raw);
    const parts = url.pathname.split("/").filter(Boolean);
    if (parts.length < 3) return null;
    if (parts[0] === "read") {
      return { mangaId: parts[1], chapterId: parts[2], medium: "Comic" };
    }
    if (parts[0] === "novel") {
      return { mangaId: parts[1], chapterId: parts[2], medium: "Novel" };
    }
  } catch {}
  return null;
}

function extractMangaPage(html) {
  if (typeof html !== "string") return null;
  const match = /window\.mangaPage\s*=\s*(\{[\s\S]*?\});\s*<\/script>/.exec(html);
  if (!match) return null;
  try {
    return JSON.parse(match[1]);
  } catch {
    return null;
  }
}

function providerFor(scanlators, id) {
  return scanlators.find((s) => s && s.id === id) || null;
}

function compareOptions(a, b) {
  return b.createdAt - a.createdAt || (b.pageCount || 0) - (a.pageCount || 0);
}

function groupChapters(rawChapters, scanlators, medium, mangaId) {
  const groups = new Map();
  for (const chapter of rawChapters || []) {
    const number = chapterNumber(chapter);
    const chapterId = chapter.id;
    if (number == null || !chapterId || !ID_PATTERN.test(chapterId)) continue;
    const providerId = chapter.scanlationMangaId || "unknown";
    const scan = providerFor(scanlators, providerId);
    const option = {
      number,
      chapterId,
      providerId,
      providerName: scan?.name || (providerId === "unknown" ? "Unknown" : `Provider ${providerId.slice(0, 6)}`),
      title: chapter.title || `Chapter ${number}`,
      pageCount: Number.isFinite(chapter.pageCount) ? chapter.pageCount : null,
      createdAt: Number(chapter.createdAt) || 0,
      url: readerUrl(mangaId, chapterId, medium),
    };
    if (!groups.has(number)) groups.set(number, { number, options: [] });
    groups.get(number).options.push(option);
  }
  return Array.from(groups.values())
    .sort((a, b) => a.number - b.number)
    .map((group) => ({ number: group.number, options: group.options.sort(compareOptions) }));
}

function rankProviders(groups, scanlators) {
  const coverage = new Map();
  for (const group of groups) {
    for (const option of group.options) {
      if (!coverage.has(option.providerId)) {
        coverage.set(option.providerId, {
          id: option.providerId,
          name: option.providerName,
          numbers: new Set(),
          score: 0,
          lastCreatedAt: 0,
        });
      }
      const entry = coverage.get(option.providerId);
      entry.numbers.add(group.number);
      entry.lastCreatedAt = Math.max(entry.lastCreatedAt, option.createdAt);
    }
  }
  for (const scan of scanlators || []) {
    if (!scan || !coverage.has(scan.id)) continue;
    const entry = coverage.get(scan.id);
    entry.name = scan.name || entry.name;
    entry.score = Number(scan.score) || 0;
  }
  return Array.from(coverage.values())
    .map((entry) => ({
      id: entry.id,
      name: entry.name,
      chapterCount: entry.numbers.size,
      score: entry.score,
      lastCreatedAt: entry.lastCreatedAt,
    }))
    .sort(
      (a, b) =>
        b.chapterCount - a.chapterCount ||
        b.score - a.score ||
        b.lastCreatedAt - a.lastCreatedAt ||
        a.name.localeCompare(b.name),
    );
}

function resolveGroup(group, options, rank) {
  const enabled =
    options.enabledSourceIds == null
      ? null
      : new Set((options.enabledSourceIds || []).map(String));
  const byProvider = new Map();
  for (const option of group.options) {
    if (!byProvider.has(option.providerId)) byProvider.set(option.providerId, []);
    byProvider.get(option.providerId).push(option);
  }

  const overrides = options.chapterOverrides || {};
  const overrideId = Object.prototype.hasOwnProperty.call(overrides, String(group.number))
    ? String(overrides[String(group.number)])
    : null;
  if (overrideId && byProvider.has(overrideId)) {
    return { choice: byProvider.get(overrideId)[0], source: "override" };
  }

  const ordered = [];
  for (const id of options.sourceOrder || []) {
    if (!ordered.includes(String(id))) ordered.push(String(id));
  }
  for (const provider of rank) {
    if (!ordered.includes(provider.id)) ordered.push(provider.id);
  }
  for (const id of ordered) {
    if (enabled && !enabled.has(id)) continue;
    if (byProvider.has(id)) return { choice: byProvider.get(id)[0], source: "enabled" };
  }
  for (const provider of rank) {
    if (byProvider.has(provider.id)) {
      return { choice: byProvider.get(provider.id)[0], source: "fallback" };
    }
  }
  return { choice: null, source: "none" };
}

function logicalChapters(groups = []) {
  const byBase = new Map();
  for (const group of groups || []) {
    const number = Number(group.number);
    if (!Number.isFinite(number) || number < 0) continue;
    const base = Math.floor(number);
    if (!byBase.has(base)) byBase.set(base, { base, integer: null, parts: [] });
    const entry = byBase.get(base);
    if (number === base) entry.integer = group;
    else entry.parts.push(group);
  }
  return Array.from(byBase.values())
    .sort((a, b) => a.base - b.base)
    .map((entry) => {
      const parts = [entry.integer, ...entry.parts]
        .filter(Boolean)
        .sort((a, b) => a.number - b.number);
      if (parts.length <= 1) return entry.integer || parts[0];
      const options = parts.flatMap((part) =>
        part.options.map((option) => ({ ...option, sourceNumber: part.number })),
      );
      return {
        number: entry.base,
        combined: true,
        parts,
        options,
      };
    });
}

function resolveSelectionGroup(group, options, rank) {
  const parts = group.combined ? group.parts : [group];
  const resolved = parts.map((part) => resolveGroup(part, options, rank));
  const choices = resolved.map((entry) => entry.choice).filter(Boolean);
  const fallbackNumbers = resolved
    .filter((entry) => entry.source === "fallback" && entry.choice)
    .map((entry) => entry.choice.number);
  const missingNumbers = resolved
    .map((entry, i) => (entry.source === "none" ? parts[i].number : null))
    .filter((number) => number !== null);

  if (!group.combined) {
    return {
      choice: resolved[0].choice,
      source: resolved[0].source,
      fallbackNumbers,
      missingNumbers,
    };
  }

  return {
    choice: choices.length
      ? {
          number: group.number,
          combined: true,
          parts: choices,
          providerId: choices[0].providerId,
          providerName: choices[0].providerName,
          title: `Chapter ${group.number}`,
          url: choices[0].url,
        }
      : null,
    source: choices.length ? "enabled" : "none",
    fallbackNumbers,
    missingNumbers,
  };
}

function selectChapters(discovery, options = {}) {
  const rank = discovery.providers || [];
  const groups = options.logicalGroups || logicalChapters(discovery.chapters);
  const prologueGroup = groups.find((group) => group.number === 0 && !group.combined) || null;
  const regular = groups.filter((group) => group.number !== 0);

  const prologue = prologueGroup ? resolveGroup(prologueGroup, options, rank) : null;
  const resolved = regular.map((group) => resolveSelectionGroup(group, options, rank));
  const chapters = resolved.map((entry) => entry.choice).filter(Boolean);
  const fallbackNumbers = resolved.flatMap((entry) => entry.fallbackNumbers);
  const missingNumbers = resolved.flatMap((entry) => entry.missingNumbers);

  return {
    chapters,
    prologue: prologue && prologue.choice ? prologue.choice : null,
    prologueSource: prologue ? prologue.source : null,
    fallbackNumbers,
    missingNumbers,
  };
}

function partLabel(numbers) {
  return numbers.map((number) => String(number)).join(" + ");
}

function buildJobSpec(discovery, options = {}) {
  const range = {
    startChapter: options.startChapter ?? null,
    endChapter: options.endChapter ?? null,
  };
  const hasRange = range.startChapter !== null || range.endChapter !== null;
  const logicalGroups = hasRange
    ? logicalChapters(discovery.chapters).filter((group) => inChapterRange(group.number, range))
    : logicalChapters(discovery.chapters);
  const selection = selectChapters(discovery, { ...options, logicalGroups });
  const chapterMeta = [];
  const chapterParts = {};
  const chapterUrls = [];
  let combinedCount = 0;

  for (const unit of selection.chapters) {
    if (unit.combined) {
      const partNumbers = unit.parts.map((part) => part.number);
      const detail = partLabel(partNumbers);
      chapterMeta.push({
        number: unit.number,
        label: `${unit.number} (${detail})`,
        detail: `Chapters ${detail}`,
        parts: partNumbers,
        partNumbers,
        combined: true,
        provider: unit.parts.map((part) => part.providerName).filter(Boolean).join(", "),
      });
      chapterUrls.push(unit.parts[0]?.url || null);
      if (unit.parts.length > 1) chapterParts[chapterUrls.length - 1] = unit.parts.map((part) => part.url);
      combinedCount += 1;
    } else {
      chapterMeta.push({
        number: unit.number,
        provider: unit.providerName,
        providerId: unit.providerId,
        chapterId: unit.chapterId,
        title: unit.title,
        url: unit.url,
      });
      chapterUrls.push(unit.url);
    }
  }

  const log = [];

  const preferred = (options.sourceOrder || []).find((id) =>
    (options.enabledSourceIds || discovery.providers.map((p) => p.id)).some(
      (enabledId) => String(enabledId) === String(id),
    ),
  );
  const primary =
    (preferred && discovery.providers.find((p) => p.id === String(preferred))) ||
    discovery.providers[0];
  if (primary) {
    log.push(`Primary provider: ${primary.name} (${primary.chapterCount} chapters).`);
  }
  if (selection.fallbackNumbers.length > 0) {
    log.push(
      `Auto-filled ${selection.fallbackNumbers.length} chapter(s) from providers outside your selection.`,
    );
  }
  if (selection.missingNumbers.length > 0) {
    log.push(`No source exists for ${selection.missingNumbers.length} chapter(s) — omitted.`);
  }
  if (selection.prologue) {
    log.push(`Prologue from ${selection.prologue.providerName}.`);
  }
  if (combinedCount > 0) {
    log.push(`Combined ${combinedCount} split chapter(s) from their decimal parts.`);
  }
  log.push(`Selected ${chapterMeta.length} chapters.`);

  return {
    title: discovery.title,
    mangaId: discovery.mangaId,
    medium: discovery.medium,
    chapterUrls,
    chapterMeta,
    chapterParts,
    prologueUrl: selection.prologue ? selection.prologue.url : null,
    log,
  };
}

async function fetchJsonSafe(path) {
  try {
    return await getJson(path);
  } catch {
    return null;
  }
}

function extractTitle(data) {
  return data?.mangaPage?.title || data?.title || null;
}

async function discoverSeries(parsed, firstChapterUrl, onLog = () => {}) {
  const fromFirst = firstChapterUrl ? parseReaderUrl(firstChapterUrl) : null;
  const mangaId = parsed.slug || fromFirst?.mangaId;
  if (!mangaId) {
    return { needFirstChapter: true, log: ["Could not determine the Atsu manga id."] };
  }
  const medium = parsed.medium || fromFirst?.medium || "Comic";
  const sourceUrl = parsed.baseUrl || `${ATSU_ORIGIN}/${medium === "Novel" ? "novel" : "manga"}/${mangaId}`;
  const log = [`Fetching Atsu chapter list for ${mangaId}…`];

  let pageData =
    (await fetchJsonSafe(`/api/manga/page?id=${encodeURIComponent(mangaId)}`)) || {};
  if (!pageData.mangaPage) {
    onLog("Page API unavailable; trying the series page inline data.");
    const page = await fetchPageSmart(sourceUrl, { attempts: 2 });
    pageData = extractMangaPage(page.data) || {};
    if (!pageData.mangaPage) log.push("Page API unavailable; inline data also missing.");
  }

  let allData =
    (await fetchJsonSafe(`/api/manga/allChapters?mangaId=${encodeURIComponent(mangaId)}`)) || {};
  let rawChapters = allData.chapters;
  if (!Array.isArray(rawChapters) || rawChapters.length === 0) {
    log.push("All-chapters API unavailable; using the inline chapter list.");
    rawChapters = pageData.mangaPage?.chapters || [];
  }

  let title = extractTitle(pageData);
  if (!title) {
    const info = await fetchJsonSafe(`/api/manga/info?mangaId=${encodeURIComponent(mangaId)}`);
    title = extractTitle(info);
  }

  const scanlators = pageData.mangaPage?.scanlators || [];
  const groups = groupChapters(rawChapters, scanlators, medium, mangaId);
  const providers = rankProviders(groups, scanlators);
  if (groups.length === 0) {
    log.push("No chapters found in the Atsu data.");
    onLog(log[log.length - 1]);
    return { needFirstChapter: true, log };
  }

  const summary = `Found ${groups.length} numbered chapter(s) across ${providers.length} provider(s).`;
  if (providers[0]) {
    log.push(`Most complete provider: ${providers[0].name} (${providers[0].chapterCount} chapters).`);
  }
  log.push(summary);
  for (const line of log) onLog(line);

  return {
    needFirstChapter: false,
    mangaId,
    medium,
    sourceUrl,
    title: title || mangaId,
    totalChapterCount: pageData.mangaPage?.totalChapterCount ?? groups.length,
    hasMoreChapters: Boolean(pageData.mangaPage?.hasMoreChapters),
    providers,
    chapters: groups,
    log,
  };
}

async function fetchChapter(url) {
  const ids = parseReaderUrl(url);
  if (!ids) {
    return { images: [], locked: false, blocked: false, notFound: true, title: null };
  }
  const query = new URLSearchParams({ mangaId: ids.mangaId, chapterId: ids.chapterId });
  try {
    const data = await getJson(`/api/read/chapter?${query}`);
    const read = data.readChapter;
    if (!read) {
      return { images: [], locked: false, blocked: false, notFound: true, title: null };
    }
    const images = (read.pages || []).map((page) => normaliseImage(page.image)).filter(Boolean);
    return {
      images,
      locked: false,
      blocked: false,
      notFound: false,
      title: read.title || null,
      rendered: false,
    };
  } catch (err) {
    if (err.status === 404) {
      return { images: [], locked: false, blocked: false, notFound: true, title: null };
    }
    throw err;
  }
}

module.exports = {
  discoverSeries,
  buildJobSpec,
  selectChapters,
  rankProviders,
  groupChapters,
  logicalChapters,
  parseReaderUrl,
  normaliseImage,
  fetchChapter,
};
