"use strict";

const form = document.getElementById("scrape-form");
const urlInput = document.getElementById("url");
const startBtn = document.getElementById("start-btn");
const errorBox = document.getElementById("error");
const progressBox = document.getElementById("progress");
const statusLabel = document.getElementById("status-label");
const chapterLabel = document.getElementById("chapter-label");
const barFill = document.getElementById("bar-fill");
const stats = document.getElementById("stats");
const logBox = document.getElementById("log");
const chapterListBox = document.getElementById("chapter-list");
const downloadBox = document.getElementById("download");
const downloadLink = document.getElementById("download-link");
const downloadCbzLink = document.getElementById("download-cbz-link");
const imageResolutionInput = document.getElementById("image-resolution");
const imageResolutionValue = document.getElementById("image-resolution-value");
const jobActionsBox = document.getElementById("job-actions");
const pauseBtn = document.getElementById("pause-btn");
const detailTitle = document.getElementById("detail-title");
const detailMeta = document.getElementById("detail-meta");
const jobsNewBtn = document.getElementById("jobs-new");
const jobsListBox = document.getElementById("jobs-list");
const jobsEmpty = document.getElementById("jobs-empty");
const archiveToggle = document.getElementById("archive-toggle");
const archiveListBox = document.getElementById("archive-list");
const archiveCount = document.getElementById("archive-count");
const archiveDeleteModal = document.getElementById("archive-delete-modal");
const archiveDeleteText = document.getElementById("archive-delete-text");
const archiveDeleteCancel = document.getElementById("archive-delete-cancel");
const archiveDeleteConfirm = document.getElementById("archive-delete-confirm");
const throttleStatusBox = document.getElementById("throttle-status");
const throttleProfileLabel = document.getElementById("throttle-profile");
const throttleDetailLabel = document.getElementById("throttle-detail");
const throttleCooldownLabel = document.getElementById("throttle-cooldown");
const firstChapterBox = document.getElementById("first-chapter");
const firstChapterForm = document.getElementById("first-chapter-form");
const firstChapterUrlInput = document.getElementById("first-chapter-url");
const firstChapterBtn = document.getElementById("first-chapter-btn");
const retryBox = document.getElementById("retry");
const retryBtn = document.getElementById("retry-btn");
const debugLogBox = document.getElementById("debug-log");
const debugClearBtn = document.getElementById("debug-clear");
const detectedBox = document.getElementById("detected");
const detectedKind = document.getElementById("detected-kind");
const sourcesPanel = document.getElementById("sources-panel");
const sourcesTitle = document.getElementById("sources-title");
const sourcesSummary = document.getElementById("sources-summary");
const sourcesAuto = document.getElementById("sources-auto");
const sourcesCancel = document.getElementById("sources-cancel");
const sourcesStart = document.getElementById("sources-start");
const sourceListBox = document.getElementById("source-list");
const chapterSourceListBox = document.getElementById("chapter-source-list");
const sourceControls = document.getElementById("source-controls");
const reviewListBox = document.getElementById("review-list");
const addChapterForm = document.getElementById("add-chapter-form");
const addChapterUrlInput = document.getElementById("add-chapter-url");
const addChapterNumberInput = document.getElementById("add-chapter-number");
const addChapterBtn = document.getElementById("add-chapter-btn");
const reviewCoverUrlInput = document.getElementById("review-cover-url");
const coverApplyBtn = document.getElementById("cover-apply-btn");
const coverApplyStatus = document.getElementById("cover-apply-status");
const coverFileInput = document.getElementById("cover-file");
const coverUploadStatus = document.getElementById("cover-upload-status");
const coverPreview = document.getElementById("cover-preview");
const resumeBox = document.getElementById("resume");
const resumeBtn = document.getElementById("resume-btn");
const detailGapsBox = document.getElementById("detail-gaps");
const detailGapsText = document.getElementById("detail-gaps-text");
const detailGapsBtn = document.getElementById("detail-gaps-btn");
const retryModal = document.getElementById("retry-modal");
const retryListBox = document.getElementById("retry-list");
const retryCancelBtn = document.getElementById("retry-cancel");
const retrySelectedBtn = document.getElementById("retry-selected");

const settingsBtn = document.getElementById("settings-btn");
const settingsMenu = document.getElementById("settings-menu");
const settingsClose = document.getElementById("settings-close");
const settingsApply = document.getElementById("settings-apply");
const startChapterInput = document.getElementById("start-chapter");
const endChapterInput = document.getElementById("end-chapter");
const chapterHyperlinksToggle = document.getElementById("chapter-hyperlinks");
const settingsModal = document.getElementById("settings-modal");
const settingsModalConfirm = document.getElementById("settings-modal-confirm");
const settingsModalCancel = document.getElementById("settings-modal-cancel");

const JOBS_KEY = "manhwa-downloader-jobs";
const DRAFTS_KEY = "manhwa-downloader-drafts";
const ARCHIVE_KEY = "manhwa-downloader-archive";
const SERIES_KEY = "manhwa-downloader-series";
const ARCHIVE_TTL_MS = 60 * 60 * 1000;
const ARCHIVE_DISCOVERY_TTL_MS = 10 * 60 * 1000;
const ARCHIVE_DISCOVERY_MAX = 3;
const ARCHIVE_LIMIT = 100;
const SERIES_LIMIT = 100;
const COVER_UPLOAD_MAX_BYTES = 5 * 1024 * 1024;
const ACTIVE_JOB_KEY = "manhwa-downloader-active-job";
const DEFAULT_SETTINGS = {
  startChapter: "",
  endChapter: "",
  concurrency: "auto",
  delay: "auto",
  globalThrottleProfile: "balanced",
  chapterHyperlinks: true,
  exportFormat: "pdf",
  imageResolutionScale: 1,
};

let settings = { ...DEFAULT_SETTINGS };
let draftSettings = { ...settings };
let settingsApplied = false;
let jobEventSource = null;
let debugEventSource = null;
let debugPollTimer = null;
let jobsPollTimer = null;
let pollingJobs = false;
let pendingConcurrency = null;
let pendingDiscovery = null;
let reviewState = null;
let sourceState = null;
let addChapterNumberAutoFilled = false;
let activeJobId = null;
let lastDebugId = 0;
let autoDiscoverTimer = null;
let discoveryGeneration = 0;
let archiveRerun = null;
let activeArchiveId = null;
let pendingArchiveDeleteId = null;
let currentDetailGapKeys = [];
let lastArchiveRenderCount = null;
let archiveDiscoveryActive = 0;
const jobs = new Map();
const chapterRows = new Map();
const archiveDiscoveryCache = new Map();
const archiveDiscoveryQueue = [];

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function fitSourceTitle() {
  if (!sourcesTitle || sourcesTitle.clientWidth === 0) return;
  sourcesTitle.style.fontSize = "";
  for (const size of [14, 13, 12, 11]) {
    sourcesTitle.style.fontSize = `${size}px`;
    if (sourcesTitle.scrollWidth <= sourcesTitle.clientWidth) return;
  }
  sourcesTitle.style.fontSize = "11px";
}

function applyDetectedChapterNumber() {
  const url = addChapterUrlInput.value.trim();
  if (!url) {
    if (addChapterNumberAutoFilled) addChapterNumberInput.value = "";
    addChapterNumberAutoFilled = false;
    return;
  }
  if (!addChapterNumberAutoFilled && addChapterNumberInput.value.trim() !== "") return;
  const detected = extractReviewChapterNumber(url);
  addChapterNumberInput.value = detected === null ? "" : String(detected);
  addChapterNumberAutoFilled = detected !== null;
}

function normalizedSettings(value) {
  const merged = { ...DEFAULT_SETTINGS, ...(value || {}) };
  merged.chapterHyperlinks = merged.chapterHyperlinks !== false;
  if (!["safe", "balanced", "fast"].includes(merged.globalThrottleProfile)) {
    merged.globalThrottleProfile = "balanced";
  }
  if (!["pdf", "cbz", "both"].includes(merged.exportFormat)) merged.exportFormat = "pdf";
  const scale = Number(merged.imageResolutionScale);
  if (!Number.isFinite(scale)) {
    merged.imageResolutionScale = 1;
  } else {
    merged.imageResolutionScale = [1, 1.25, 1.5, 1.75, 2].reduce((best, step) =>
      Math.abs(step - scale) < Math.abs(best - scale) ? step : best,
    );
  }
  return merged;
}

function updateSettings(value) {
  const normalized = normalizedSettings(value);
  normalized.startChapter = null;
  normalized.endChapter = null;
  return normalized;
}

function resetSettingsApplied() {
  settingsApplied = false;
  settingsApply.textContent = "Apply";
  settingsApply.classList.remove("applied");
}

function markSettingsApplied() {
  settingsApplied = true;
  settingsApply.textContent = "✓ Applied!";
  settingsApply.classList.add("applied");
}

function renderSettings() {
  startChapterInput.value = draftSettings.startChapter ?? "";
  endChapterInput.value = draftSettings.endChapter ?? "";
  chapterHyperlinksToggle.setAttribute("aria-checked", String(draftSettings.chapterHyperlinks !== false));
  const scale = normalizedSettings(draftSettings).imageResolutionScale;
  if (imageResolutionInput) imageResolutionInput.value = String(scale);
  if (imageResolutionValue) {
    imageResolutionValue.textContent = scale === 1 ? "1× (current)" : `${scale}×`;
  }
  for (const key of ["exportFormat", "concurrency", "delay", "globalThrottleProfile"]) {
    const value = String(draftSettings[key] ?? (key === "exportFormat" ? "pdf" : "auto"));
    const label = document.getElementById(`${key}-value`);
    if (label) {
      label.textContent =
        key === "exportFormat"
          ? value === "pdf"
            ? "PDF"
            : value === "cbz"
              ? "CBZ"
              : "Both"
          : key === "globalThrottleProfile"
            ? value.charAt(0).toUpperCase() + value.slice(1)
            : value === "auto"
              ? "Auto"
              : key === "delay"
                ? `${value}ms`
                : value;
    }
    for (const option of document.querySelectorAll(`[data-select="${key}"] .select-option`)) {
      option.setAttribute("aria-selected", String(option.dataset.value === value));
    }
  }
}

function openSettings() {
  draftSettings = { ...settings };
  resetSettingsApplied();
  renderSettings();
  show(settingsMenu);
  settingsBtn.setAttribute("aria-expanded", "true");
}

function closeSettings() {
  hide(settingsMenu);
  hide(settingsModal);
  closeAllSelects();
  pendingConcurrency = null;
  draftSettings = { ...settings };
  renderSettings();
  settingsBtn.setAttribute("aria-expanded", "false");
}

function closeAllSelects(except = null) {
  for (const root of document.querySelectorAll(".custom-select")) {
    if (root === except) continue;
    const options = root.querySelector(".select-options");
    const trigger = root.querySelector(".select-trigger");
    if (options) hide(options);
    if (trigger) trigger.setAttribute("aria-expanded", "false");
  }
}

function applySetting(key, value) {
  draftSettings[key] = value;
  resetSettingsApplied();
  renderSettings();
}

function commitSettings() {
  const committed = normalizedSettings(draftSettings);
  settings = committed;
  draftSettings = { ...committed };
  const draft = activeDraft();
  if (draft) {
    draft.settings = { ...committed };
    syncActiveDraft();
  }
  markSettingsApplied();
  renderSettings();
}

function setupCustomSelect(key) {
  const root = document.querySelector(`.custom-select[data-select="${key}"]`);
  if (!root) return;
  const trigger = root.querySelector(".select-trigger");
  const optionsBox = root.querySelector(".select-options");
  const options = [...root.querySelectorAll(".select-option")];

  trigger.addEventListener("click", () => {
    const willOpen = optionsBox.classList.contains("hidden");
    closeAllSelects(root);
    if (willOpen) {
      show(optionsBox);
      trigger.setAttribute("aria-expanded", "true");
      const selected = options.find((option) => option.dataset.value === String(draftSettings[key]));
      (selected || options[0])?.focus();
    } else {
      hide(optionsBox);
      trigger.setAttribute("aria-expanded", "false");
    }
  });

  for (const option of options) {
    option.addEventListener("click", () => {
      hide(optionsBox);
      trigger.setAttribute("aria-expanded", "false");
      const value = option.dataset.value;
      if (key === "concurrency" && (value === "3" || value === "4") && String(draftSettings.concurrency) !== value) {
        pendingConcurrency = value;
        show(settingsModal);
        settingsModalConfirm.focus();
        return;
      }
      applySetting(key, value);
    });
  }

  root.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.stopPropagation();
      hide(optionsBox);
      trigger.setAttribute("aria-expanded", "false");
      trigger.focus();
      return;
    }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
    const index = options.indexOf(document.activeElement);
    if (index === -1) return;
    event.preventDefault();
    const delta = event.key === "ArrowDown" ? 1 : -1;
    options[(index + delta + options.length) % options.length].focus();
  });
}

settingsBtn.addEventListener("click", (event) => {
  event.stopPropagation();
  const openSelect = document.querySelector(".custom-select .select-options:not(.hidden)");
  if (openSelect) {
    closeAllSelects();
    return;
  }
  if (settingsMenu.classList.contains("hidden")) openSettings();
  else closeSettings();
});
settingsClose.addEventListener("click", () => closeSettings());
settingsApply.addEventListener("click", () => {
  commitSettings();
  closeAllSelects();
});
settingsModalCancel.addEventListener("click", (event) => {
  event.stopPropagation();
  pendingConcurrency = null;
  hide(settingsModal);
  renderSettings();
});
settingsModalConfirm.addEventListener("click", (event) => {
  event.stopPropagation();
  if (pendingConcurrency) applySetting("concurrency", pendingConcurrency);
  pendingConcurrency = null;
  hide(settingsModal);
});
startChapterInput.addEventListener("input", () => applySetting("startChapter", startChapterInput.value.trim()));
endChapterInput.addEventListener("input", () => applySetting("endChapter", endChapterInput.value.trim()));
chapterHyperlinksToggle.addEventListener("click", () => {
  applySetting("chapterHyperlinks", chapterHyperlinksToggle.getAttribute("aria-checked") !== "true");
});
imageResolutionInput?.addEventListener("input", () => {
  applySetting("imageResolutionScale", Number(imageResolutionInput.value));
});
setupCustomSelect("exportFormat");
setupCustomSelect("concurrency");
setupCustomSelect("delay");
setupCustomSelect("globalThrottleProfile");

document.addEventListener("click", (event) => {
  if (!retryModal.classList.contains("hidden")) {
    if (event.target === retryModal) closeRetryModal();
    return;
  }
  const modalOpen = !settingsModal.classList.contains("hidden");
  const clickedSettings = settingsMenu.contains(event.target);
  const clickedSelect = Boolean(event.target.closest(".custom-select"));
  const openSelect = document.querySelector(".custom-select .select-options:not(.hidden)");

  if (modalOpen) {
    if (!settingsModal.contains(event.target) && !clickedSelect) {
      pendingConcurrency = null;
      hide(settingsModal);
      renderSettings();
    }
    return;
  }

  if (openSelect && !clickedSelect) {
    closeAllSelects();
    return;
  }

  if (!settingsMenu.classList.contains("hidden") && !clickedSettings) {
    closeSettings();
    return;
  }

  if (!clickedSelect) closeAllSelects();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!retryModal.classList.contains("hidden")) {
    closeRetryModal();
    return;
  }
  if (!archiveDeleteModal.classList.contains("hidden")) {
    closeArchiveDeleteModal();
    return;
  }
  if (!settingsModal.classList.contains("hidden")) {
    pendingConcurrency = null;
    hide(settingsModal);
    renderSettings();
    return;
  }
  const openSelect = document.querySelector(".custom-select .select-options:not(.hidden)");
  if (openSelect) {
    closeAllSelects();
    return;
  }
  if (!settingsMenu.classList.contains("hidden")) closeSettings();
});

renderSettings();

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function kindLabel(kind) {
  if (kind === "asura") return "Asura Scans";
  if (kind === "atsu") return "Atsu.moe";
  return "Generic site";
}

function isValidHttpUrl(value) {
  try {
    return /^https?:$/.test(new URL(value).protocol);
  } catch {
    return false;
  }
}

function logicalChapterNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return null;
  return Math.floor(number);
}

function uniqueChapterNumbers(values) {
  const seen = new Set();
  for (const value of values || []) {
    const number = logicalChapterNumber(value);
    if (number !== null) seen.add(number);
  }
  return [...seen].sort((a, b) => a - b);
}

function seriesKeyFromUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    const parts = url.pathname.split("/").filter(Boolean);
    if (host.includes("asurascans.com")) {
      const index = parts.findIndex((part) => part.toLowerCase() === "comics");
      if (index >= 0 && parts[index + 1]) return `asura:${parts[index + 1]}`;
    }
    if (host.includes("atsu.moe")) {
      const index = parts.findIndex((part) => ["manga", "novel"].includes(part.toLowerCase()));
      if (index >= 0 && parts[index + 1]) return `atsu:${parts[index + 1]}`;
    }
    return `${host}:${parts.slice(0, 2).join("/") || "/"}`;
  } catch {
    return String(value).trim();
  }
}

function loadSeriesHistory() {
  let data = [];
  try {
    data = JSON.parse(localStorage.getItem(SERIES_KEY) || "[]");
  } catch {}
  if (!Array.isArray(data)) return [];
  return data.filter((record) => record && record.key);
}

function persistSeriesHistory(records) {
  try {
    localStorage.setItem(SERIES_KEY, JSON.stringify(records.slice(0, SERIES_LIMIT)));
  } catch {}
}

function getSeriesRecord(key) {
  if (!key) return null;
  return loadSeriesHistory().find((record) => record.key === key) || null;
}

function upsertSeriesRecord(record) {
  if (!record?.key) return null;
  const records = loadSeriesHistory();
  const index = records.findIndex((entry) => entry.key === record.key);
  if (index >= 0) records[index] = { ...records[index], ...record };
  else records.unshift(record);
  persistSeriesHistory(records);
  return record;
}

function collectArchiveDownloadedKeys(key) {
  const numbers = [];
  for (const record of loadArchive()) {
    const recordKey = record.detail?.seriesKey || seriesKeyFromUrl(record.url);
    if (recordKey !== key) continue;
    for (const chapter of record.detail?.chapters || []) {
      if (chapter.status !== "done") continue;
      numbers.push(chapter.number ?? chapter.chapter);
    }
  }
  return uniqueChapterNumbers(numbers);
}

function seriesGapsFor(key, expected) {
  const record = getSeriesRecord(key);
  const expectedNumbers = uniqueChapterNumbers(
    expected?.length ? expected : record?.expectedChapterKeys,
  );
  if (expectedNumbers.length === 0) return [];
  const downloaded = new Set([
    ...(record?.downloadedChapterKeys || []),
    ...collectArchiveDownloadedKeys(key),
  ]);
  return expectedNumbers.filter((number) => !downloaded.has(number));
}

function rememberSeriesDiscovery({ key, url, title, chapterNumbers }) {
  if (!key) return null;
  const record = getSeriesRecord(key) || {
    key,
    expectedChapterKeys: [],
    knownChapterKeys: [],
    downloadedChapterKeys: [],
  };
  if (url) record.url = url;
  if (title) record.title = title;
  record.expectedChapterKeys = uniqueChapterNumbers([
    ...(record.expectedChapterKeys || []),
    ...(chapterNumbers || []),
  ]);
  record.lastSyncAt = Date.now();
  return upsertSeriesRecord(record);
}

function rememberSeriesStart(payload, expectedChapterKeys) {
  const key = payload.seriesKey || seriesKeyFromUrl(payload.url);
  if (!key) return;
  const record = getSeriesRecord(key) || {
    key,
    expectedChapterKeys: [],
    knownChapterKeys: [],
    downloadedChapterKeys: [],
  };
  record.url = payload.url || record.url;
  record.expectedChapterKeys = uniqueChapterNumbers([
    ...(record.expectedChapterKeys || []),
    ...(expectedChapterKeys || []),
  ]);
  record.knownChapterKeys = uniqueChapterNumbers([
    ...(record.knownChapterKeys || []),
    ...(payload.includeChapterKeys || []),
  ]);
  record.settings = { ...settings };
  if (payload.coverToken) record.coverToken = payload.coverToken;
  else if (payload.coverUrl) record.coverToken = null;
  if (payload.coverUrl) record.coverUrl = payload.coverUrl;
  record.lastSyncAt = Date.now();
  upsertSeriesRecord(record);
}

function updateSeriesFromSnapshot(snap) {
  const key = snap.seriesKey || seriesKeyFromUrl(jobs.get(snap.id)?.url || urlInput.value);
  if (!key) return;
  const chapters = snap.chapters || [];
  const allNumbers = chapters.map((chapter) => chapter.number ?? chapter.chapter);
  const doneNumbers = chapters
    .filter((chapter) => chapter.status === "done")
    .map((chapter) => chapter.number ?? chapter.chapter);
  const record = getSeriesRecord(key) || {
    key,
    expectedChapterKeys: [],
    knownChapterKeys: [],
    downloadedChapterKeys: [],
  };
  record.url = record.url || jobs.get(snap.id)?.url || urlInput.value;
  record.title = snap.title || record.title;
  record.expectedChapterKeys = uniqueChapterNumbers([
    ...(record.expectedChapterKeys || []),
    ...allNumbers,
  ]);
  record.knownChapterKeys = uniqueChapterNumbers([
    ...(record.knownChapterKeys || []),
    ...allNumbers,
  ]);
  record.downloadedChapterKeys = uniqueChapterNumbers([
    ...(record.downloadedChapterKeys || []),
    ...doneNumbers,
  ]);
  record.lastSyncAt = Date.now();
  upsertSeriesRecord(record);
}

function showTemporaryDetailStatus(message) {
  if (!detailMeta || progressBox.classList.contains("hidden")) return;
  const previous = detailMeta.textContent;
  detailMeta.textContent = message;
  setTimeout(() => {
    if (detailMeta.textContent === message) detailMeta.textContent = previous;
  }, 3500);
}

function renderDetailGaps(snap, url) {
  if (!detailGapsBox) return;
  const key = snap.seriesKey || seriesKeyFromUrl(url);
  const chapters = (snap.chapters || []).map((chapter) => chapter.number ?? chapter.chapter);
  const expected = uniqueChapterNumbers([...(getSeriesRecord(key)?.expectedChapterKeys || []), ...chapters]);
  const gaps = key ? seriesGapsFor(key, expected) : [];
  currentDetailGapKeys = gaps;
  if (gaps.length === 0) {
    detailGapsText.textContent = "";
    hide(detailGapsBox);
    return;
  }
  detailGapsText.textContent = `Missing ${gaps.length} chapter${gaps.length === 1 ? "" : "s"}: ${gaps.slice(0, 12).join(", ")}${gaps.length > 12 ? "…" : ""}`;
  show(detailGapsBox);
}

function setCoverApplyStatus(message, applied = false) {
  coverApplyStatus.textContent = message;
  coverApplyStatus.classList.toggle("applied", applied);
}

function applyCoverUrl() {
  if (!reviewState) return;
  const value = reviewCoverUrlInput.value.trim();
  if (value && !isValidHttpUrl(value)) {
    setError("Cover image URL must be a valid http(s) URL.");
    setCoverApplyStatus("Invalid cover URL", false);
    return;
  }
  clearError();
  const detected = reviewState.detectedCoverUrl || "";
  reviewState.appliedCoverUrl = value && value !== detected ? value : null;
  reviewState.coverToken = null;
  if (coverPreview) coverPreview.classList.add("hidden");
  if (coverUploadStatus) {
    coverUploadStatus.textContent = "";
    coverUploadStatus.classList.remove("applied");
  }
  if (value) {
    setCoverApplyStatus(value === detected ? "Detected cover applied" : "Cover applied", true);
  } else {
    setCoverApplyStatus(detected ? "Using detected cover" : "No cover", Boolean(detected));
  }
  syncActiveDraft();
}

async function uploadCoverFile(file) {
  if (!reviewState || !file) return;
  if (!/^image\/(jpeg|png|webp)$/i.test(file.type)) {
    setError("Choose a JPG, PNG, or WebP cover image.");
    return;
  }
  if (file.size > COVER_UPLOAD_MAX_BYTES) {
    setError("Cover image must be 5 MB or smaller.");
    return;
  }
  clearError();
  if (coverUploadStatus) coverUploadStatus.textContent = "Uploading…";
  try {
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(new Error("Could not read that image."));
      reader.readAsDataURL(file);
    });
    const res = await fetch("/api/covers", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dataUrl }),
    });
    const body = await readJson(res);
    if (!res.ok) {
      setError(body.error || "Could not upload the cover image.");
      if (coverUploadStatus) coverUploadStatus.textContent = "";
      return;
    }
    reviewState.coverToken = body.coverToken;
    reviewState.appliedCoverUrl = null;
    reviewCoverUrlInput.value = "";
    if (coverPreview) {
      coverPreview.src = dataUrl;
      coverPreview.classList.remove("hidden");
    }
    if (coverUploadStatus) {
      coverUploadStatus.textContent = "Cover uploaded";
      coverUploadStatus.classList.add("applied");
    }
    setCoverApplyStatus("Local cover applied", true);
    syncActiveDraft();
  } catch (err) {
    debugClient("error", `Cover upload failed: ${err.message}`);
    setError("Could not upload the cover image.");
    if (coverUploadStatus) coverUploadStatus.textContent = "";
  }
}

function extractReviewChapterNumber(url) {
  try {
    const path = new URL(url).pathname;
    const patterns = [
      /\/chapters?[/-](\d+(?:\.\d+)?)/i,
      /\/chap(?:ter)?[/-](\d+(?:\.\d+)?)/i,
      /\/c\/(\d+(?:\.\d+)?)/i,
      /\/episodes?[/-](\d+(?:\.\d+)?)/i,
      /(\d+(?:\.\d+)?)\/?$/,
    ];
    for (const pattern of patterns) {
      const match = path.match(pattern);
      if (match) return Number(match[1]);
    }
  } catch {}
  return null;
}

function findReviewChapter(chapters, key) {
  for (const chapter of chapters || []) {
    if (chapter.key === key) return chapter;
    const part = findReviewChapter(chapter.parts || [], key);
    if (part) return part;
  }
  return null;
}

function isPartEnabled(key) {
  return !sourceState || !sourceState.partEnabled.has(key) || sourceState.partEnabled.get(key) !== false;
}

function initializePartState(state) {
  state.partEnabled = new Map();
  state.disabledParts = new Set(state.defaults?.excludedPartKeys || []);
  for (const chapter of state.chapters || []) {
    for (const part of chapter.parts || []) {
      state.partEnabled.set(part.key, !state.disabledParts.has(part.key));
    }
  }
}

function syncDisabledParts() {
  const disabled = new Set();
  for (const [key, enabled] of sourceState.partEnabled) {
    if (!enabled) disabled.add(key);
  }
  sourceState.disabledParts = disabled;
}

function enforcePartSelection(recentKey) {
  for (const group of sourceState.chapters || []) {
    if (!group.parts || group.parts.length === 0) continue;
    const enabled = group.parts.filter((part) => isPartEnabled(part.key));
    if (enabled.length > 0) continue;
    const main = group.parts.find((part) => Number(part.number) === Number(group.number));
    const fallback = main || group.parts.find((part) => part.key === recentKey) || group.parts[0];
    sourceState.partEnabled.set(fallback.key, true);
  }
}

function renderReviewChapters() {
  if (!reviewState) {
    reviewListBox.innerHTML = "";
    syncActiveDraft();
    return;
  }

  const openKeys = new Set(
    [...reviewListBox.querySelectorAll("details.review-parts[open]")].map((details) => details.dataset.key),
  );
  const rows = [];
  const rowHtml = (chapter, part = false) => {
    const url = chapter.customUrl || chapter.url || "";
    const badge = chapter.added ? "Added" : chapter.customUrl ? "Custom" : "";
    const enabled = part ? isPartEnabled(chapter.key) : true;
    const toggle = part
      ? `<label class="part-toggle"><input type="checkbox" data-part-toggle="${escapeHtml(chapter.key)}" ${enabled ? "checked" : ""} />Include</label>`
      : "";
    return `<div class="ch-row review-row${part ? " part" : ""}${part && !enabled ? " excluded" : ""}" data-key="${escapeHtml(chapter.key)}">
      <span class="ch-num">${escapeHtml(chapter.label)}</span>
      <span class="ch-provider">${escapeHtml(badge)}</span>
      <span class="review-url${chapter.customUrl ? " custom" : ""}" title="${escapeHtml(url)}">${escapeHtml(url)}</span>
      <span class="ch-status ready">Ready</span>
      ${toggle}
      <button type="button" class="ch-edit" data-key="${escapeHtml(chapter.key)}">Edit link</button>
    </div>`;
  };

  for (const chapter of reviewState.chapters) {
    rows.push(rowHtml(chapter));
    const parts = chapter.parts || [];
    if (parts.length === 0) continue;
    const included = parts.filter((part) => isPartEnabled(part.key)).length;
    rows.push(`<details class="review-parts" data-key="${escapeHtml(chapter.key)}"${openKeys.has(chapter.key) ? " open" : ""}>
      <summary>Subchapters (${included}/${parts.length} included)</summary>
      ${parts.map((part) => rowHtml(part, true)).join("")}
    </details>`);
  }

  reviewListBox.innerHTML = rows.join("");
  for (const button of reviewListBox.querySelectorAll(".ch-edit")) {
    button.addEventListener("click", () => {
      const row = button.closest(".review-row");
      beginChapterEdit(button.dataset.key, row);
    });
  }
  for (const input of reviewListBox.querySelectorAll("[data-part-toggle]")) {
    input.addEventListener("change", () => {
      if (!sourceState) return;
      sourceState.partEnabled.set(input.dataset.partToggle, input.checked);
      enforcePartSelection(input.dataset.partToggle);
      syncDisabledParts();
      renderReviewChapters();
      renderChapterSourceList();
    });
  }
  syncActiveDraft();
}

function beginChapterEdit(key, row) {
  if (!reviewState || !row) return;
  const chapter = findReviewChapter(reviewState.chapters, key);
  if (!chapter) return;

  const existing = reviewListBox.querySelector(".review-edit-form");
  if (existing) existing.remove();

  const form = document.createElement("form");
  form.className = "review-edit-form";
  form.innerHTML = `<input type="url" required autocomplete="off" value="${escapeHtml(chapter.customUrl || chapter.url || "")}" aria-label="Custom chapter URL" /><button type="submit">Save</button><button type="button" class="sources-cancel">Cancel</button>`;
  const input = form.querySelector("input");
  form.querySelector(".sources-cancel").addEventListener("click", () => form.remove());
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = input.value.trim();
    if (!isValidHttpUrl(value)) {
      setError("Chapter link must be a valid http(s) URL.");
      input.focus();
      return;
    }
    chapter.customUrl = value;
    reviewState.overrides[key] = value;
    clearError();
    renderReviewChapters();
  });
  row.insertAdjacentElement("afterend", form);
  input.focus();
  input.select();
}

function addReviewChapter(event) {
  event.preventDefault();
  if (!reviewState) return;
  clearError();

  const url = addChapterUrlInput.value.trim();
  if (!isValidHttpUrl(url)) {
    setError("Chapter link must be a valid http(s) URL.");
    addChapterUrlInput.focus();
    return;
  }

  const manual = addChapterNumberInput.value.trim();
  const number = manual === "" ? extractReviewChapterNumber(url) : Number(manual);
  if (!Number.isFinite(number) || number < 0) {
    setError("Could not find a chapter number. Enter one manually.");
    addChapterNumberInput.focus();
    return;
  }

  const key = number === 0 ? "0" : `added:${number}`;
  if (findReviewChapter(reviewState.chapters, key)) {
    setError(`Chapter ${number} is already listed. Use Edit link instead.`);
    return;
  }

  reviewState.chapters.push({
    key,
    number,
    label: number === 0 ? "Prologue" : `Chapter ${number}`,
    url,
    customUrl: url,
    added: true,
    combined: false,
    parts: null,
  });
  reviewState.chapters.sort((a, b) => {
    const an = Number.isFinite(Number(a.number)) ? Number(a.number) : Number.MAX_SAFE_INTEGER;
    const bn = Number.isFinite(Number(b.number)) ? Number(b.number) : Number.MAX_SAFE_INTEGER;
    return an - bn;
  });
  addChapterUrlInput.value = "";
  addChapterNumberInput.value = "";
  addChapterNumberAutoFilled = false;
  renderReviewChapters();
}

function readChapterRange(values = settings) {
  const parse = (value, label) => {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error(`${label} must be a whole chapter number of 0 or greater.`);
    }
    return n;
  };
  const startChapter = parse(values.startChapter, "Start chapter");
  const endChapter = parse(values.endChapter, "End chapter");
  if (startChapter !== null && endChapter !== null && startChapter > endChapter) {
    throw new Error("Start chapter cannot be greater than end chapter.");
  }
  return { startChapter, endChapter };
}

function requestBody(extra = {}, values = settings) {
  const normalized = normalizedSettings(values);
  const range = readChapterRange(normalized);
  return {
    ...range,
    settings: {
      concurrency: normalized.concurrency,
      delay: normalized.delay,
      globalThrottleProfile: normalized.globalThrottleProfile,
      chapterHyperlinks: normalized.chapterHyperlinks,
      exportFormat: normalized.exportFormat,
      imageResolutionScale: normalized.imageResolutionScale,
    },
    ...extra,
  };
}

function buildScrapePayload(overrides = {}) {
  if (!reviewState || !reviewState.token) {
    throw new Error("This chapter preview expired. Search again.");
  }
  const extra = {
    discoveryToken: reviewState.token,
    chapterUrlOverrides: { ...reviewState.overrides },
    addedChapters: reviewState.chapters
      .filter((chapter) => chapter.added)
      .map((chapter) => ({
        number: chapter.number,
        url: chapter.customUrl || chapter.url,
        label: chapter.label,
      })),
    coverUrl: reviewState.appliedCoverUrl || reviewState.detectedCoverUrl || undefined,
    coverToken: reviewState.coverToken || undefined,
    ...overrides,
  };
  if (sourceState) {
    extra.sourceOrder = [...sourceState.order];
    extra.enabledSourceIds = [...sourceState.enabled];
    extra.chapterOverrides = { ...sourceState.overrides };
    extra.excludedPartKeys = [...sourceState.disabledParts];
  }
  return requestBody(extra);
}

function handleErrorResponse(res, body) {
  debugClient("warn", `Request responded ${res.status}`);
  for (const entry of body.log || []) {
    const message = typeof entry === "string" ? entry : entry.message;
    debugClient("info", `discovery: ${message}`);
  }
  if (body.code === "NEED_FIRST_CHAPTER") {
    setError(body.error || "Could not find the first chapter.");
    show(firstChapterBox);
    firstChapterUrlInput.focus();
    return;
  }
  setError(body.error || "Request failed.");
}

async function readJson(res) {
  try {
    return await res.json();
  } catch {
    return {};
  }
}

function resetComposer() {
  hide(firstChapterBox);
  hide(sourcesPanel);
  hide(detectedBox);
  reviewListBox.innerHTML = "";
  reviewCoverUrlInput.value = "";
  setCoverApplyStatus("", false);
  if (coverFileInput) coverFileInput.value = "";
  if (coverPreview) {
    coverPreview.removeAttribute("src");
    coverPreview.classList.add("hidden");
  }
  if (coverUploadStatus) {
    coverUploadStatus.textContent = "";
    coverUploadStatus.classList.remove("applied");
  }
  pendingDiscovery = null;
  reviewState = null;
  sourceState = null;
}

function resetDetailState() {
  logBox.innerHTML = "";
  chapterListBox.innerHTML = "";
  chapterRows.clear();
  hide(chapterListBox);
  hide(logBox);
  hide(downloadBox);
  hide(jobActionsBox);
  hide(retryBox);
  hide(resumeBox);
  hide(detailGapsBox);
  hide(progressBox);
  stats.innerHTML = "";
  detailTitle.textContent = "";
  detailMeta.textContent = "";
}

function appendDebug(level, message) {
  const nearBottom =
    debugLogBox.scrollHeight - debugLogBox.scrollTop - debugLogBox.clientHeight < 24;
  const div = document.createElement("div");
  div.className = level === "error" ? "error" : level === "warn" ? "warn" : "";
  div.textContent = message;
  debugLogBox.appendChild(div);
  while (debugLogBox.childElementCount > 200) debugLogBox.firstElementChild.remove();
  if (nearBottom) debugLogBox.scrollTop = debugLogBox.scrollHeight;
}

function debugClient(level, message) {
  appendDebug(level, `[client ${new Date().toLocaleTimeString()}] ${message}`);
}

function setError(msg) {
  errorBox.textContent = msg;
  show(errorBox);
  debugClient("error", msg);
}

function clearError() {
  errorBox.textContent = "";
  hide(errorBox);
}

function classify(line) {
  const t = line.toLowerCase();
  if (t.includes("fatal")) return "err";
  if (t.includes("skipped") || t.includes("locked") || t.includes("not found") || t.includes("retrying") || t.includes("failed")) return "warn";
  return "";
}

function renderLog(log, state) {
  if (!log || log.length === 0) return;
  show(logBox);
  for (let i = 0; i < log.length; i++) {
    const entry = log[i];
    const message = typeof entry === "string" ? entry : entry.message;
    let key;
    if (typeof entry === "object" && entry.id != null) key = `id:${entry.id}`;
    else key = `index:${i}`;
    if (!state || state.logSeen.has(key)) continue;
    state.logSeen.add(key);
    const cls = classify(message);
    const div = document.createElement("div");
    div.textContent = message;
    div.className = cls;
    logBox.appendChild(div);
    if (cls === "err" || cls === "warn") appendDebug(cls, `chapter: ${message}`);
  }
  logBox.scrollTop = logBox.scrollHeight;
}

function currentChapterText(snap) {
  const total = snap.totalChapters || 0;
  if (snap.currentChapter === null || snap.currentChapter === undefined) {
    return total > 0 ? `${total} chapters` : "";
  }
  const active = (snap.chapters || []).find(
    (chapter) => Number(chapter.chapter) === Number(snap.currentChapter),
  );
  const raw = active?.label ?? snap.currentChapter;
  const text = String(raw);
  if (/^(chapter|prologue)\b/i.test(text)) return text;
  return `Chapter ${text}`;
}

function maxChapterNumber(snap) {
  const values = [snap.lastChapter, snap.endChapter];
  for (const value of values) {
    if (value === null || value === undefined || value === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  let max = null;
  for (const chapter of snap.chapters || []) {
    const raw = chapter.label ?? chapter.chapter ?? chapter.number;
    const match = typeof raw === "string" ? raw.match(/\d+(?:\.\d+)?/) : null;
    const number = match ? Number(match[0]) : Number(raw);
    if (Number.isFinite(number)) max = max === null ? number : Math.max(max, number);
  }
  if (max !== null) return max;
  if (snap.firstChapter && snap.totalChapters) {
    return Number(snap.firstChapter) + Number(snap.totalChapters) - 1;
  }
  return snap.totalChapters || 0;
}

function detailDownloads(snap) {
  const fallbackPartial = Boolean(snap?.partialDownload);
  const result = {};
  const add = (format, url, partial) => {
    const normalized = String(format || "pdf").toLowerCase();
    if (!url || !["pdf", "cbz"].includes(normalized) || result[normalized]) return;
    result[normalized] = { url, partial: Boolean(partial) };
  };
  if (Array.isArray(snap?.downloads)) {
    for (const entry of snap.downloads) {
      if (typeof entry === "string") add("pdf", entry, fallbackPartial);
      else add(entry?.format, entry?.url, entry?.partial ?? fallbackPartial);
    }
  } else if (snap?.downloads && typeof snap.downloads === "object") {
    for (const [format, entry] of Object.entries(snap.downloads)) {
      if (typeof entry === "string") add(format, entry, fallbackPartial);
      else add(format || entry?.format, entry?.url, entry?.partial ?? fallbackPartial);
    }
  }
  add("pdf", snap?.downloadUrl, snap?.partialDownload);
  return result;
}

function downloadLabel(format, partial) {
  const name = format === "cbz" ? "CBZ" : "PDF";
  return `${partial ? "Download partial " : "Download "}${name}`;
}

function downloadActionHtml(downloads, attribute, id, className) {
  const links = [];
  for (const format of ["pdf", "cbz"]) {
    const entry = downloads[format];
    if (!entry) continue;
    links.push(
      `<a class="${className}" href="${escapeHtml(entry.url)}" data-${attribute}="${escapeHtml(id)}" data-format="${format}" download>${downloadLabel(format, entry.partial)}</a>`,
    );
  }
  return links.join("");
}

function renderDetail(snap, state, { archived = false } = {}) {
  show(progressBox);
  const total = snap.totalChapters || 0;
  const done = snap.completedChapters ?? 0;
  detailTitle.textContent = snap.title || snap.slug || "Untitled export";
  const meta = [kindLabel(snap.kind)];
  if (snap.startChapter !== null || snap.endChapter !== null) {
    const start = snap.startChapter ?? "first";
    const end = snap.endChapter ?? "last";
    meta.push(`Chapters ${start}–${end}`);
  }
  detailMeta.textContent = meta.join(" · ");

  barFill.style.width = total > 0 ? `${(Math.min(1, done / total) * 100).toFixed(1)}%` : "100%";
  barFill.style.animation = total > 0 ? "" : "none";

  if (snap.status === "running" && snap.paused) {
    statusLabel.textContent = "Paused";
    chapterLabel.textContent = currentChapterText(snap);
  } else if (snap.status === "running") {
    if (snap.phase === "assembling") {
      statusLabel.textContent = "Assembling PDF…";
      chapterLabel.textContent = `${done} / ${total} chapters scraped`;
    } else if (snap.phase === "discovering") {
      statusLabel.innerHTML = `<span class="spin"></span> Locating chapters…`;
      chapterLabel.textContent = "";
    } else {
      statusLabel.textContent = `Downloading ${currentChapterText(snap)}`;
      chapterLabel.textContent = `${done} / ${total} chapters`;
    }
  } else if (snap.status === "complete") {
    statusLabel.textContent = "Complete";
    chapterLabel.textContent = `${total} chapters`;
  } else if (snap.status === "failed") {
    statusLabel.textContent = "Failed";
    chapterLabel.textContent = total > 0 ? `${total} chapters` : "";
  } else {
    statusLabel.textContent = snap.status;
    chapterLabel.textContent = total > 0 ? `${total} chapters` : "";
  }

  const badges = [];
  if (snap.pages) badges.push(`<span class="badge ok">${snap.pages} pages</span>`);
  if (snap.skipped) badges.push(`<span class="badge warn">${snap.skipped} skipped</span>`);
  if (snap.locked) badges.push(`<span class="badge warn">${snap.locked} locked</span>`);
  stats.innerHTML = badges.join(" ");

  renderChapters(snap.chapters || [], snap.currentChapter);
  renderLog(snap.log, state);

  const downloads = detailDownloads(snap);
  if (downloads.pdf || downloads.cbz) {
    show(downloadBox);
    for (const [format, link] of [["pdf", downloadLink], ["cbz", downloadCbzLink]]) {
      if (!link) continue;
      if (downloads[format]) {
        link.href = downloads[format].url;
        link.textContent = downloadLabel(format, downloads[format].partial);
        show(link);
      } else {
        hide(link);
      }
    }
  } else {
    hide(downloadBox);
    if (downloadLink) hide(downloadLink);
    if (downloadCbzLink) hide(downloadCbzLink);
  }

  if (!archived && snap.status === "running") {
    show(jobActionsBox);
    pauseBtn.textContent = snap.userPaused ? "Resume export" : "Pause export";
  } else {
    hide(jobActionsBox);
  }

  if (!archived && snap.status === "failed" && snap.resumable) {
    show(resumeBox);
    resumeBtn.textContent = snap.phase === "interrupted"
      ? "Resume after restart"
      : "Resume from last completed chapter";
  } else {
    hide(resumeBox);
  }

  if (!archived && snap.status === "complete" && (snap.tempCleaned || snap.retryable?.length > 0)) {
    show(retryBox);
    retryBtn.textContent = snap.tempCleaned
      ? "Rebuild PDF from source"
      : `Retry ${snap.retryable.length} failed chapter(s)`;
  } else {
    hide(retryBox);
  }

  const detailUrl = archived
    ? archiveRecord(activeArchiveId)?.url || urlInput.value
    : jobs.get(activeJobId)?.url || urlInput.value;
  if (snap.status === "complete" || snap.status === "failed") {
    renderDetailGaps(snap, detailUrl);
  } else {
    currentDetailGapKeys = [];
    if (detailGapsText) detailGapsText.textContent = "";
    if (detailGapsBox) hide(detailGapsBox);
  }
}

function renderChapters(chapters, activeChapter) {
  if (!chapters || chapters.length === 0) {
    chapterListBox.innerHTML = "";
    chapterRows.clear();
    hide(chapterListBox);
    return;
  }

  show(chapterListBox);
  const seen = new Set();
  for (const ch of chapters) {
    const key = Number(ch.chapter);
    seen.add(key);
    let row = chapterRows.get(key);
    if (!row) {
      row = document.createElement("div");
      row.className = "ch-row";
      row.innerHTML = `<span class="ch-num"></span><span class="ch-provider"></span><span class="ch-bar-holder"></span><span class="ch-status"></span>`;
      chapterRows.set(key, row);
    }
    const num = row.querySelector(".ch-num");
    const provider = row.querySelector(".ch-provider");
    const holder = row.querySelector(".ch-bar-holder");
    const statusEl = row.querySelector(".ch-status");

    const rawLabel = ch.label !== undefined && ch.label !== null ? ch.label : ch.chapter;
    const label = ch.prologue ? "Prologue" : /^(chapter|prologue)\b/i.test(String(rawLabel)) ? String(rawLabel) : `Chapter ${rawLabel}`;
    num.textContent = label;
    provider.textContent = ch.provider || "";

    const barPct = ch.pagesTotal > 0 ? (ch.pagesDone / ch.pagesTotal * 100) : 0;
    if (ch.status === "scraping") {
      holder.innerHTML = `<div class="ch-bar"><div class="ch-bar-fill" style="width:${barPct.toFixed(1)}%"></div></div>`;
    } else if (ch.status === "done") {
      holder.innerHTML = `<div class="ch-bar"><div class="ch-bar-fill" style="width:100%"></div></div>`;
    } else {
      holder.innerHTML = `<div class="ch-bar"></div>`;
    }

    let statusText = ch.status;
    if (ch.status === "skipped" && ch.reason) statusText = ch.reason;
    if (ch.status === "scraping" && ch.pagesTotal > 0) statusText = `${ch.pagesDone}/${ch.pagesTotal}`;
    statusEl.textContent = statusText;
    statusEl.className = `ch-status ${ch.status === "skipped" ? "skipped" : ch.status === "locked" ? "locked" : ch.status}`;
    row.classList.toggle("active", key === activeChapter);
    chapterListBox.appendChild(row);
  }

  for (const [key, row] of chapterRows) {
    if (seen.has(key)) continue;
    row.remove();
    chapterRows.delete(key);
  }

  const activeRow = chapterListBox.querySelector(".ch-row.active");
  if (activeRow) activeRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function scheduleAutoDiscovery() {
  if (autoDiscoverTimer) clearTimeout(autoDiscoverTimer);
  const generation = ++discoveryGeneration;
  const draft = activeDraft();
  if (!draft) return;
  const value = urlInput.value.trim();
  if (draft.url !== value) resetComposer();
  draft.url = value;
  draft.error = null;
  draft.phase = value ? "ready" : "blank";
  draft.title = draftTitleFromUrl(value);
  syncActiveDraft();
  if (!value || !isValidHttpUrl(value)) return;
  autoDiscoverTimer = setTimeout(() => {
    if (generation !== discoveryGeneration) return;
    const current = activeDraft();
    if (!current || current.id !== draft.id || current.url !== value) return;
    startScrape(null, { auto: true });
  }, 700);
}

async function startScrape(firstChapterUrl, { auto = false } = {}) {
  const generation = ++discoveryGeneration;
  if (!auto) archiveRerun = null;
  clearError();
  resetComposer();

  const url = urlInput.value.trim();
  const draft = activeDraft();
  if (draft) {
    draft.url = url;
    draft.error = null;
    draft.phase = url ? "ready" : "blank";
    draft.title = draftTitleFromUrl(url);
    syncActiveDraft();
  }
  if (!url) return;

  let body;
  try {
    body = requestBody({ url, firstChapterUrl: firstChapterUrl || undefined });
  } catch (err) {
    setError(err.message);
    markActiveDraftError(err.message);
    openSettings();
    return;
  }

  if (!auto) {
    startBtn.disabled = true;
    startBtn.textContent = "Finding chapters…";
  }

  try {
    const res = await fetch("/api/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await readJson(res);
    if (generation !== discoveryGeneration) return;
    if (!res.ok) {
      const message = result.error || "Could not find chapters.";
      if (archiveRerun?.generation === generation) archiveRerun = null;
      markActiveDraftError(message);
      handleErrorResponse(res, result);
      return;
    }

    detectedKind.textContent = kindLabel(result.detectedKind);
    show(detectedBox);

    pendingDiscovery = result;
    const detectedCoverUrl = isValidHttpUrl(result.coverUrl || "") ? result.coverUrl : "";
    reviewState = {
      token: result.discoveryToken,
      chapters: (result.chapters || []).map((chapter) => ({ ...chapter })),
      overrides: {},
      detectedCoverUrl,
      appliedCoverUrl: null,
    };
    reviewCoverUrlInput.value = detectedCoverUrl;
    setCoverApplyStatus(detectedCoverUrl ? "Detected cover applied" : "No cover found", Boolean(detectedCoverUrl));
    const seriesKey = seriesKeyFromUrl(url);
    rememberSeriesDiscovery({
      key: seriesKey,
      url,
      title: result.title || hostLabel(url),
      chapterNumbers: result.chapterNumbers || result.chapters.map((chapter) => chapter.number),
    });
    for (const line of result.log || []) debugClient("info", `discovery: ${line}`);

    if ((result.providers || []).length > 0) {
      renderSources(result);
      show(sourceControls);
      show(sourcesAuto);
    } else {
      sourceState = null;
      hide(sourceControls);
      hide(sourcesAuto);
      sourcesTitle.textContent = result.title || "this series";
      sourcesSummary.textContent = `${reviewState.chapters.length} chapters found`;
    }

    if (reviewState.chapters.length === 0) {
      setError("No chapters found. Try a direct chapter link or add one manually.");
    }
    if (draft?.draft && activeJobId === draft.id) {
      draft.title = `Job - ${result.title || hostLabel(url)}`;
      draft.phase = "review";
      draft.error = null;
    }
    renderReviewChapters();
    show(sourcesPanel);
    fitSourceTitle();
    syncActiveDraft();
    if (archiveRerun?.generation === generation) applyArchiveRerun();
  } catch (err) {
    if (generation !== discoveryGeneration) return;
    if (archiveRerun?.generation === generation) archiveRerun = null;
    markActiveDraftError("Network error while finding chapters.");
    debugClient("error", `POST /api/discover: ${err.message}`);
    setError("Network error while finding chapters.");
  } finally {
    if (!auto && generation === discoveryGeneration) {
      startBtn.disabled = false;
      startBtn.textContent = "Find chapters";
    }
  }
}

function cloneValue(value) {
  return value === null || value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function hostLabel(value) {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "New Job";
  }
}

function draftTitleFromUrl(value) {
  return value ? `Job - ${hostLabel(value)}` : "New Job";
}

function activeDraft() {
  const state = jobs.get(activeJobId);
  return state?.draft ? state : null;
}

function serializeSources(state) {
  if (!state) return null;
  return {
    token: state.token,
    order: [...state.order],
    enabled: [...state.enabled],
    overrides: { ...state.overrides },
    providers: [...state.providers.entries()],
    chapters: cloneValue(state.chapters),
    defaults: { ...state.defaults },
    partEnabled: [...state.partEnabled.entries()],
    disabledParts: [...state.disabledParts],
  };
}

function hydrateSources(data) {
  if (!data) return null;
  return {
    token: data.token,
    order: [...(data.order || [])],
    enabled: new Set(data.enabled || []),
    overrides: { ...(data.overrides || {}) },
    providers: new Map(data.providers || []),
    chapters: cloneValue(data.chapters) || [],
    defaults: { ...(data.defaults || {}) },
    partEnabled: new Map(data.partEnabled || []),
    disabledParts: new Set(data.disabledParts || []),
  };
}

function sanitizeArchiveDetail(snap) {
  if (!snap) return null;
  return {
    title: snap.title || null,
    slug: snap.slug || null,
    kind: snap.kind || null,
    status: snap.status || null,
    phase: snap.phase || null,
    resumable: Boolean(snap.resumable),
    seriesKey: snap.seriesKey || null,
    paused: Boolean(snap.paused),
    userPaused: Boolean(snap.userPaused),
    currentChapter: snap.currentChapter ?? null,
    firstChapter: snap.firstChapter ?? null,
    lastChapter: snap.lastChapter ?? null,
    startChapter: snap.startChapter ?? null,
    endChapter: snap.endChapter ?? null,
    totalChapters: snap.totalChapters ?? null,
    completedChapters: snap.completedChapters ?? 0,
    pages: snap.pages ?? 0,
    skipped: snap.skipped ?? 0,
    locked: snap.locked ?? 0,
    downloadUrl: snap.downloadUrl || null,
    partialDownload: Boolean(snap.partialDownload),
    downloads: cloneValue(snap.downloads),
    settings: snap.settings ? { ...snap.settings } : null,
    retryable: Array.isArray(snap.retryable) ? snap.retryable.slice(0, 100) : [],
    tempCleaned: Boolean(snap.tempCleaned),
    finishedAt: snap.finishedAt || null,
    error: snap.error || null,
    chapters: (snap.chapters || []).slice(-100).map((chapter) => ({ ...chapter })),
    log: (snap.log || []).slice(-100).map((entry) =>
      typeof entry === "string" ? entry : { ...entry },
    ),
  };
}

function sanitizeArchivePayload(payload) {
  const copy = cloneValue(payload) || {};
  delete copy.discoveryToken;
  return copy;
}

function sanitizeArchiveReview(state) {
  if (!state) return null;
  return {
    chapters: (state.chapters || []).map((chapter) => ({
      key: chapter.key,
      number: chapter.number,
      label: chapter.label,
      url: chapter.url,
      customUrl: chapter.customUrl,
      added: Boolean(chapter.added),
    })),
    overrides: { ...(state.overrides || {}) },
    detectedCoverUrl: state.detectedCoverUrl || null,
    appliedCoverUrl: state.appliedCoverUrl || null,
    coverToken: state.coverToken || null,
  };
}

function sanitizeArchiveSources(state) {
  if (!state) return null;
  return {
    order: [...(state.order || [])],
    enabled: [...(state.enabled || [])],
    overrides: { ...(state.overrides || {}) },
    defaults: { ...(state.defaults || {}) },
    disabledParts: [...(state.disabledParts || [])],
  };
}

function archivePayloadFromDraft(draft) {
  if (!draft?.url) return null;
  const payload = {
    ...draft.settings,
    url: draft.url,
    seriesKey: draft.seriesKey || seriesKeyFromUrl(draft.url),
    settings: { ...draft.settings },
  };
  if (draft.review) {
    payload.chapterUrlOverrides = { ...(draft.review.overrides || {}) };
    payload.addedChapters = (draft.review.chapters || [])
      .filter((chapter) => chapter.added)
      .map((chapter) => ({
        number: chapter.number,
        url: chapter.customUrl || chapter.url,
        label: chapter.label,
      }));
    payload.coverUrl = draft.review.appliedCoverUrl || draft.review.detectedCoverUrl || undefined;
    if (draft.review.coverToken) payload.coverToken = draft.review.coverToken;
  }
  if (draft.sources) {
    payload.sourceOrder = [...(draft.sources.order || [])];
    payload.enabledSourceIds = [...(draft.sources.enabled || [])];
    payload.chapterOverrides = { ...(draft.sources.overrides || {}) };
    payload.excludedPartKeys = [...(draft.sources.disabledParts || [])];
  }
  return payload;
}

function loadArchive() {
  let data = [];
  try {
    data = JSON.parse(localStorage.getItem(ARCHIVE_KEY) || "[]");
  } catch {}
  if (!Array.isArray(data)) return [];
  return data
    .filter((record) => record && record.id)
    .sort((a, b) => (b.finishedAt || b.createdAt || 0) - (a.finishedAt || a.createdAt || 0));
}

function persistArchive(records) {
  try {
    localStorage.setItem(ARCHIVE_KEY, JSON.stringify(records.slice(0, ARCHIVE_LIMIT)));
  } catch {}
}

function archiveRecord(id) {
  return loadArchive().find((record) => record.id === id) || null;
}

function upsertArchiveRecord(record) {
  const records = loadArchive();
  const index = records.findIndex((entry) => entry.id === record.id);
  if (index >= 0) records[index] = { ...records[index], ...record };
  else records.unshift(record);
  persistArchive(records);
  renderArchive();
}

function captureArchiveStart(jobId, payload, draft) {
  const url = payload.url || draft?.url || "";
  upsertArchiveRecord({
    id: jobId,
    url,
    title: pendingDiscovery?.title
      ? `Job - ${pendingDiscovery.title}`
      : draft?.title || draftTitleFromUrl(url),
    status: "queued",
    kind: pendingDiscovery?.detectedKind || "generic",
    seriesKey: payload.seriesKey || seriesKeyFromUrl(url),
    createdAt: Date.now(),
    finishedAt: null,
    downloadUrl: null,
    downloads: null,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    startChapter: payload.startChapter ?? settings.startChapter ?? null,
    endChapter: payload.endChapter ?? settings.endChapter ?? null,
    firstChapterUrl: payload.firstChapterUrl || null,
    payload: sanitizeArchivePayload(payload),
    review: sanitizeArchiveReview(reviewState),
    sources: sanitizeArchiveSources(sourceState),
  });
}

function updateArchiveFromSnapshot(snap) {
  const record = archiveRecord(snap.id) || {
    id: snap.id,
    createdAt: snap.createdAt || Date.now(),
    finishedAt: null,
    url: "",
    title: "Untitled export",
    settings: { ...settings },
    payload: null,
  };
  record.title = snap.title || record.title || "Untitled export";
  record.status = snap.status || record.status;
  record.kind = snap.kind || record.kind;
  record.seriesKey = snap.seriesKey || record.detail?.seriesKey || record.seriesKey || seriesKeyFromUrl(record.url);
  if (snap.settings) record.settings = normalizedSettings(snap.settings);
  record.paused = Boolean(snap.paused);
  record.detail = sanitizeArchiveDetail(snap);
  record.downloadUrl = snap.downloadUrl || record.downloadUrl || null;
  record.downloads = cloneValue(snap.downloads) || record.downloads || null;
  record.totalChapters = snap.totalChapters ?? record.totalChapters;
  if ((snap.status === "complete" || snap.status === "failed") && !record.finishedAt) {
    record.finishedAt = snap.finishedAt || Date.now();
  }
  upsertArchiveRecord(record);
}

function archiveDownloadUrl(record, format = "pdf") {
  const downloads = detailDownloads(record.detail || record);
  return downloads[format]?.url || null;
}

function archiveDownloadValid(record, format = "pdf") {
  return Boolean(
    archiveDownloadUrl(record, format) &&
      record.finishedAt &&
      Date.now() - record.finishedAt < ARCHIVE_TTL_MS,
  );
}

async function archiveJob(id, { pause = false } = {}) {
  const state = jobs.get(id);
  if (!state || state.archived) return;
  let pausedByArchive = false;
  if (
    pause &&
    !state.draft &&
    state.snap?.status === "running" &&
    !state.snap.userPaused
  ) {
    pausedByArchive = true;
    try {
      const res = await fetch(`/api/jobs/${id}/pause`, { method: "POST" });
      if (res.ok) handleSnapshot(await readJson(res));
    } catch (err) {
      debugClient("warn", `Could not pause ${id} before archiving: ${err.message}`);
    }
  }
  const snap = state.snap;
  const url = state.draft ? state.url || "" : "";
  const record = archiveRecord(id) || {
    id,
    title: snap?.title || state.title || "Untitled export",
    url,
    status: snap?.status || state.status || "draft",
    kind: snap?.kind || null,
    seriesKey: snap?.seriesKey || state.seriesKey || seriesKeyFromUrl(url),
    createdAt: snap?.createdAt || state.createdAt || Date.now(),
    finishedAt: snap?.status === "complete" || snap?.status === "failed"
      ? snap.finishedAt || Date.now()
      : null,
    downloadUrl: snap?.downloadUrl || null,
    downloads: cloneValue(snap?.downloads),
    paused: pausedByArchive || Boolean(snap?.paused),
    detail: sanitizeArchiveDetail(snap),
    totalChapters: snap?.totalChapters || state.chapterCount || 0,
    settings: state.draft ? { ...state.settings } : { ...settings },
    payload: state.draft ? archivePayloadFromDraft(state) : null,
    review: state.draft ? sanitizeArchiveReview(state.review) : null,
    sources: state.draft ? sanitizeArchiveSources(state.sources) : null,
  };
  if (snap) {
    record.title = snap.title || record.title;
    record.status = snap.status;
    record.downloadUrl = snap.downloadUrl || record.downloadUrl;
    record.downloads = cloneValue(snap.downloads) || record.downloads || null;
    if (snap.settings) record.settings = normalizedSettings(snap.settings);
    record.paused = pausedByArchive || Boolean(snap.paused);
    record.detail = sanitizeArchiveDetail(snap);
    record.totalChapters = snap.totalChapters ?? record.totalChapters;
    if ((snap.status === "complete" || snap.status === "failed") && !record.finishedAt) {
      record.finishedAt = snap.finishedAt || Date.now();
    }
  }
  state.archived = true;
  upsertArchiveRecord(record);
  removeJob(id);
  if (jobs.size === 0) {
    if (autoDiscoverTimer) clearTimeout(autoDiscoverTimer);
    archiveRerun = null;
    activeArchiveId = null;
    discoveryGeneration += 1;
    clearError();
    resetComposer();
    urlInput.value = "";
    createDraftJob();
  }
}

function openArchivedJob(id) {
  const record = archiveRecord(id);
  if (!record) return;
  if (autoDiscoverTimer) clearTimeout(autoDiscoverTimer);
  archiveRerun = null;
  discoveryGeneration += 1;
  clearError();
  const draft = createDraftJob({ select: false });
  draft.url = record.url || "";
  draft.title = record.title || draftTitleFromUrl(draft.url);
  draft.settings = normalizedSettings(record.settings);
  draft.review = cloneValue(record.review);
  draft.sources = hydrateSources(record.sources);
  draft.seriesKey = record.seriesKey || record.detail?.seriesKey || seriesKeyFromUrl(draft.url);
  draft.coverUrl = record.review?.appliedCoverUrl || record.review?.detectedCoverUrl || null;
  draft.chapterCount = record.totalChapters || record.review?.chapters?.length || 0;
  draft.detail = cloneValue(record.detail);
  draft.archivedFrom = id;
  selectJob(draft.id);
  activeArchiveId = id;
  renderArchive();
}

function deleteArchivedJob(id) {
  const record = archiveRecord(id);
  if (record) {
    archiveDiscoveryCache.delete(archiveCacheKey(record));
    archiveDiscoveryCache.delete(record.id);
  }
  persistArchive(loadArchive().filter((record) => record.id !== id));
  for (const state of jobs.values()) {
    if (state.archivedFrom === id) state.archivedFrom = null;
  }
  if (activeArchiveId === id) activeArchiveId = null;
  persistDrafts();
  renderArchive();
}

function openArchiveDeleteModal(id) {
  const record = archiveRecord(id);
  if (!record) return;
  pendingArchiveDeleteId = id;
  archiveDeleteText.textContent = `Delete "${record.title || "Untitled export"}" from this browser's archive?`;
  show(archiveDeleteModal);
  archiveDeleteConfirm.focus();
}

function closeArchiveDeleteModal() {
  pendingArchiveDeleteId = null;
  hide(archiveDeleteModal);
}

function archiveCacheKey(record) {
  return record.seriesKey || record.detail?.seriesKey || seriesKeyFromUrl(record.url) || record.id;
}

function expectedKeysFromDiscovery(result) {
  const values = result?.chapterNumbers?.length
    ? result.chapterNumbers
    : (result?.chapters || []).map((chapter) => chapter.number ?? chapter.chapter);
  return uniqueChapterNumbers(values);
}

function archiveUpdateKeys(record, key, result) {
  const expected = expectedKeysFromDiscovery(result);
  const current = getSeriesRecord(key);
  const downloaded = new Set([
    ...(current?.downloadedChapterKeys || []),
    ...collectArchiveDownloadedKeys(key),
  ]);
  const known = new Set([...(current?.knownChapterKeys || []), ...downloaded]);
  const gaps = seriesGapsFor(key, expected);
  return uniqueChapterNumbers([...expected.filter((number) => !known.has(number)), ...gaps]);
}

function drainArchiveDiscoveryQueue() {
  while (archiveDiscoveryActive < ARCHIVE_DISCOVERY_MAX && archiveDiscoveryQueue.length > 0) {
    const task = archiveDiscoveryQueue.shift();
    archiveDiscoveryActive += 1;
    task();
  }
}

function queueArchiveDiscoveryCheck(cacheKey, record, key) {
  if (archiveDiscoveryCache.has(cacheKey)) return;
  archiveDiscoveryCache.set(cacheKey, {
    state: "checking",
    checkedAt: Date.now(),
    newKeys: [],
    discoveryResult: null,
  });
  const task = async () => {
    try {
      if (!archiveRecord(record.id)) return;
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody({ url: record.url }, updateSettings(record.settings))),
      });
      const result = await readJson(res);
      if (!res.ok) throw new Error(result.error || `HTTP ${res.status}`);
      const newKeys = archiveUpdateKeys(record, key, result);
      archiveDiscoveryCache.set(cacheKey, {
        state: newKeys.length ? "available" : "upToDate",
        checkedAt: Date.now(),
        newKeys,
        discoveryResult: result,
      });
    } catch (err) {
      archiveDiscoveryCache.set(cacheKey, {
        state: "error",
        checkedAt: Date.now(),
        newKeys: [],
        discoveryResult: null,
      });
      debugClient("warn", `Archive update check failed for ${record.title || record.id}: ${err.message}`);
    } finally {
      archiveDiscoveryActive -= 1;
      renderArchive();
      drainArchiveDiscoveryQueue();
    }
  };
  if (archiveDiscoveryActive < ARCHIVE_DISCOVERY_MAX) {
    archiveDiscoveryActive += 1;
    task();
  } else {
    archiveDiscoveryQueue.push(task);
  }
}

function renderArchive() {
  if (!archiveListBox) return;
  const records = loadArchive();
  if (lastArchiveRenderCount !== null && records.length > lastArchiveRenderCount) {
    if (archiveToggle && archiveListBox.classList.contains("hidden")) {
      show(archiveListBox);
      archiveToggle.setAttribute("aria-expanded", "true");
    }
  }
  lastArchiveRenderCount = records.length;
  if (archiveCount) archiveCount.textContent = String(records.length);
  if (records.length === 0) {
    archiveListBox.innerHTML = '<div class="jobs-empty">No archived jobs yet.</div>';
    return;
  }
  const rows = [];
  for (const record of records) {
    const statusText =
      record.status === "complete"
        ? "✓ Done"
        : record.status === "failed"
          ? "Failed"
          : record.status === "running"
            ? record.paused
              ? "Paused"
              : "Running"
            : "Archived";
    const statusClass =
      record.status === "complete"
        ? "done"
        : record.status === "failed"
          ? "failed"
          : record.status === "running" && record.paused
            ? "paused"
            : "";
    const actions = [];
    const downloads = detailDownloads(record.detail || record);
    for (const format of ["pdf", "cbz"]) {
      if (!archiveDownloadValid(record, format)) continue;
      actions.push(
        `<a class="archive-row-download" href="${escapeHtml(downloads[format].url)}" data-archive-download="${escapeHtml(record.id)}" data-format="${format}" download>${downloadLabel(format, downloads[format].partial)}</a>`,
      );
    }
    if (!archiveDownloadValid(record) && record.url) {
      actions.push(
        `<button type="button" class="archive-row-rerun" data-archive-rerun="${escapeHtml(record.id)}">Rerun</button>`,
      );
    }
    const terminal = record.status === "complete" || record.status === "failed";
    let updateKey = null;
    if (terminal && record.url) {
      updateKey = archiveCacheKey(record);
      const cached = archiveDiscoveryCache.get(updateKey);
      if (!cached || Date.now() - cached.checkedAt >= ARCHIVE_DISCOVERY_TTL_MS) {
        queueArchiveDiscoveryCheck(updateKey, record, updateKey);
      }
      const current = archiveDiscoveryCache.get(updateKey);
      if (current?.state === "available" && current.newKeys.length > 0) {
        actions.push(
          `<button type="button" class="archive-row-rerun" data-archive-update="${escapeHtml(record.id)}" title="Download ${current.newKeys.length} new chapter${current.newKeys.length === 1 ? "" : "s"}">Update</button>`,
        );
      } else if (current?.state === "checking") {
        actions.push('<span class="archive-row-hint">Checking…</span>');
      } else if (current?.state === "upToDate") {
        actions.push('<span class="archive-row-hint">Up to date</span>');
      }
    }
    actions.push(
      `<button type="button" class="archive-row-delete" data-archive-delete="${escapeHtml(record.id)}" aria-label="Delete archived job" title="Delete archived job">×</button>`,
    );
    rows.push(`<div class="archive-row ${activeArchiveId === record.id ? "selected" : ""}" data-id="${escapeHtml(record.id)}" role="button" tabindex="0">
      <span class="archive-row-title" title="${escapeHtml(record.title)}">${escapeHtml(record.title)}</span>
      <span class="archive-row-status ${statusClass}">${escapeHtml(statusText)}</span>
      <span class="archive-row-actions">${actions.join("")}</span>
    </div>`);
  }
  archiveListBox.innerHTML = rows.join("");
  for (const row of archiveListBox.querySelectorAll(".archive-row")) {
    row.addEventListener("click", () => openArchivedJob(row.dataset.id));
    row.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      openArchivedJob(row.dataset.id);
    });
  }
  for (const link of archiveListBox.querySelectorAll("[data-archive-download]")) {
    link.addEventListener("click", (event) => event.stopPropagation());
    link.addEventListener("keydown", (event) => event.stopPropagation());
  }
  for (const button of archiveListBox.querySelectorAll("[data-archive-rerun]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      rerunArchivedJob(button.dataset.archiveRerun);
    });
    button.addEventListener("keydown", (event) => event.stopPropagation());
  }
  for (const button of archiveListBox.querySelectorAll("[data-archive-update]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const record = archiveRecord(button.dataset.archiveUpdate);
      if (!record) return;
      const key = record.seriesKey || record.detail?.seriesKey || seriesKeyFromUrl(record.url);
      const cacheKey = archiveCacheKey(record);
      const cached = archiveDiscoveryCache.get(cacheKey);
      const options = {
        title: record.title,
        seriesKey: key,
        settings: record.settings,
        archiveCacheKey: cacheKey,
      };
      if (cached?.state === "available" && cached.discoveryResult && cached.newKeys.length > 0) {
        options.discoveryResult = cached.discoveryResult;
        options.includeKeys = cached.newKeys;
      }
      updateSeries(record.url, options);
    });
    button.addEventListener("keydown", (event) => event.stopPropagation());
  }
  for (const button of archiveListBox.querySelectorAll("[data-archive-delete]")) {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openArchiveDeleteModal(button.dataset.archiveDelete);
    });
    button.addEventListener("keydown", (event) => event.stopPropagation());
  }
}

function rerunArchivedJob(id) {
  const record = archiveRecord(id);
  if (!record) return;
  if (!record.url) {
    setError("No saved URL for this archived job.");
    return;
  }
  clearError();
  if (autoDiscoverTimer) clearTimeout(autoDiscoverTimer);
  const draft = createDraftJob({ select: true });
  draft.url = record.url;
  draft.seriesKey = record.seriesKey || record.detail?.seriesKey || seriesKeyFromUrl(record.url);
  draft.settings = { ...DEFAULT_SETTINGS, ...(record.settings || {}) };
  draft.title = record.title || draftTitleFromUrl(record.url);
  urlInput.value = record.url;
  settings = normalizedSettings(draft.settings);
  draftSettings = { ...settings };
  renderSettings();
  archiveRerun = {
    generation: discoveryGeneration + 1,
    review: cloneValue(record.review),
    sources: cloneValue(record.sources),
    payload: cloneValue(record.payload),
  };
  syncActiveDraft();
  startScrape(null, { auto: true });
}

function applyArchiveRerun() {
  const rerun = archiveRerun;
  if (!rerun) return;
  archiveRerun = null;
  if (reviewState && rerun.review) {
    for (const saved of rerun.review.chapters || []) {
      const target =
        (reviewState.chapters || []).find((chapter) => saved.key && chapter.key === saved.key) ||
        (reviewState.chapters || []).find(
          (chapter) => saved.number != null && Number(chapter.number) === Number(saved.number),
        );
      if (target) {
        if (saved.customUrl) target.customUrl = saved.customUrl;
        if (saved.added) {
          target.added = true;
          target.label = saved.label || target.label;
        }
      } else if (saved.added && saved.url) {
        reviewState.chapters.push({ ...saved, customUrl: saved.customUrl || saved.url });
      }
    }
    const cover = rerun.review.appliedCoverUrl || rerun.payload?.coverUrl;
    if (rerun.review.coverToken || rerun.payload?.coverToken) {
      reviewState.coverToken = rerun.review.coverToken || rerun.payload.coverToken;
      setCoverApplyStatus("Saved cover upload applied", true);
      if (coverUploadStatus) coverUploadStatus.textContent = "Saved cover upload applied";
    } else if (cover && isValidHttpUrl(cover)) {
      reviewState.appliedCoverUrl = cover;
      reviewCoverUrlInput.value = cover;
      setCoverApplyStatus("Cover applied", true);
    }
  }
  if (sourceState && rerun.sources) {
    if (rerun.sources.order?.length) sourceState.order = [...rerun.sources.order];
    if (rerun.sources.enabled) sourceState.enabled = new Set(rerun.sources.enabled);
    if (rerun.sources.overrides) sourceState.overrides = { ...rerun.sources.overrides };
    if (rerun.sources.disabledParts) {
      sourceState.disabledParts = new Set(rerun.sources.disabledParts);
      initializePartState(sourceState);
      for (const key of sourceState.partEnabled.keys()) {
        sourceState.partEnabled.set(key, !sourceState.disabledParts.has(key));
      }
    }
  }
  renderReviewChapters();
  if (sourceState) {
    renderSourceList();
    renderChapterSourceList();
  }
  syncActiveDraft();
  let payload;
  try {
    payload = buildScrapePayload();
  } catch (err) {
    setError(err.message);
    return;
  }
  startJob(payload);
}

function serializeDraft(state) {
  return {
    id: state.id,
    draft: true,
    title: state.title || "New Job",
    url: state.url || "",
    seriesKey: state.seriesKey || seriesKeyFromUrl(state.url),
    settings: { ...state.settings },
    discovery: cloneValue(state.discovery),
    review: cloneValue(state.review),
    sources: serializeSources(state.sources),
    coverUrl: state.coverUrl || null,
    chapterCount: state.chapterCount || 0,
    detail: cloneValue(state.detail),
    archivedFrom: state.archivedFrom || null,
    phase: state.phase || "blank",
    error: state.error || null,
    createdAt: state.createdAt,
    updatedAt: state.updatedAt,
  };
}

function persistDrafts() {
  const data = {};
  for (const [id, state] of jobs) {
    if (state.draft) data[id] = serializeDraft(state);
  }
  try {
    sessionStorage.setItem(DRAFTS_KEY, JSON.stringify(data));
  } catch {}
}

function restoreDrafts() {
  let data = {};
  try {
    data = JSON.parse(sessionStorage.getItem(DRAFTS_KEY) || "{}");
  } catch {}
  if (!data || typeof data !== "object" || Array.isArray(data)) return;
  for (const [id, record] of Object.entries(data)) {
    if (!id.startsWith("draft:") || jobs.has(id)) continue;
    jobs.set(id, {
      ...record,
      id,
      draft: true,
      status: "draft",
      logSeen: new Set(),
      settings: { ...DEFAULT_SETTINGS, ...(record.settings || {}) },
    });
  }
}

function createDraftJob({ select = true } = {}) {
  const id = `draft:${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const now = Date.now();
  const state = {
    id,
    draft: true,
    status: "draft",
    title: "New Job",
    url: "",
    seriesKey: null,
    settings: { ...DEFAULT_SETTINGS },
    discovery: null,
    review: null,
    sources: null,
    coverUrl: null,
    chapterCount: 0,
    detail: null,
    archivedFrom: null,
    phase: "blank",
    error: null,
    createdAt: now,
    updatedAt: now,
    logSeen: new Set(),
  };
  jobs.set(id, state);
  persistJobs();
  persistDrafts();
  renderJobsList();
  if (select) selectJob(id);
  return state;
}

function syncActiveDraft() {
  const draft = activeDraft();
  if (!draft) return;
  draft.url = urlInput.value.trim();
  draft.seriesKey = draft.seriesKey || seriesKeyFromUrl(draft.url);
  draft.discovery = cloneValue(pendingDiscovery);
  draft.review = cloneValue(reviewState);
  draft.sources = serializeSources(sourceState);
  draft.coverUrl = reviewState?.appliedCoverUrl || reviewState?.detectedCoverUrl || null;
  draft.chapterCount = reviewState?.chapters?.length || pendingDiscovery?.chapters?.length || 0;
  if (pendingDiscovery?.title) draft.title = `Job - ${pendingDiscovery.title}`;
  else if (draft.url && draft.title === "New Job") draft.title = draftTitleFromUrl(draft.url);
  else if (!draft.url) draft.title = "New Job";
  if (draft.phase !== "error") {
    draft.phase = draft.review ? "review" : draft.url ? "ready" : "blank";
  }
  draft.updatedAt = Date.now();
  persistDrafts();
  persistJobs();
  renderJobsList();
}

function markActiveDraftError(message) {
  const draft = activeDraft();
  if (!draft) return;
  draft.phase = "error";
  draft.error = message;
  syncActiveDraft();
}

function hydrateDraftIntoComposer(state) {
  clearError();
  resetComposer();
  urlInput.value = state.url || "";
  const savedSettings = normalizedSettings(state.settings);
  settings = savedSettings;
  draftSettings = { ...savedSettings };
  renderSettings();
  pendingDiscovery = cloneValue(state.discovery);
  reviewState = cloneValue(state.review);
  sourceState = hydrateSources(state.sources);
  if (state.detail) {
    renderDetail(state.detail, { logSeen: new Set() }, { archived: true });
  } else {
    resetDetailState();
  }
  if (!reviewState) return;
  detectedKind.textContent = kindLabel(pendingDiscovery?.detectedKind);
  show(detectedBox);
  reviewCoverUrlInput.value = reviewState.appliedCoverUrl || reviewState.detectedCoverUrl || "";
  if (reviewState.coverToken) {
    setCoverApplyStatus("Saved cover upload applied", true);
    if (coverUploadStatus) coverUploadStatus.textContent = "Saved cover upload applied";
  }
  renderReviewChapters();
  show(sourcesPanel);
  if (sourceState) {
    show(sourceControls);
    show(sourcesAuto);
    sourcesTitle.textContent = pendingDiscovery?.title || "this series";
    sourcesSummary.textContent = `${sourceState.chapters.length} chapters · ${sourceState.providers.size} providers`;
    renderSourceList();
    renderChapterSourceList();
  } else {
    hide(sourceControls);
    hide(sourcesAuto);
    sourcesTitle.textContent = pendingDiscovery?.title || "this series";
    sourcesSummary.textContent = `${reviewState.chapters.length} chapters found`;
  }
}

function convertDraftToServerJob(draftId, serverId) {
  const entries = [...jobs.entries()];
  const index = entries.findIndex(([id]) => id === draftId);
  const realState = { id: serverId, logSeen: new Set(), status: null };
  if (index >= 0) entries.splice(index, 1, [serverId, realState]);
  else entries.push([serverId, realState]);
  jobs.clear();
  for (const [id, state] of entries) jobs.set(id, state);
  activeJobId = serverId;
  persistJobs();
  persistDrafts();
}

function persistJobs() {
  try {
    sessionStorage.setItem(JOBS_KEY, JSON.stringify([...jobs.keys()]));
    if (activeJobId) sessionStorage.setItem(ACTIVE_JOB_KEY, activeJobId);
    else sessionStorage.removeItem(ACTIVE_JOB_KEY);
  } catch {}
}

function restoreJobs() {
  restoreDrafts();
  let ids = [];
  try {
    ids = JSON.parse(sessionStorage.getItem(JOBS_KEY) || "[]");
  } catch {}
  if (!Array.isArray(ids)) ids = [];
  for (const id of ids) {
    if (typeof id === "string" && !jobs.has(id)) {
      jobs.set(id, { id, logSeen: new Set(), status: null });
    }
  }
  if (jobs.size === 0) createDraftJob({ select: false });
  let active = null;
  try {
    active = sessionStorage.getItem(ACTIVE_JOB_KEY);
  } catch {}
  if (!active || !jobs.has(active)) active = [...jobs.keys()][jobs.size - 1];
  selectJob(active);
  pollAllJobs();
}

function jobState(id) {
  let state = jobs.get(id);
  if (!state) {
    state = { id, logSeen: new Set(), status: null };
    jobs.set(id, state);
  }
  return state;
}

function removeJob(id) {
  const wasActive = activeJobId === id;
  jobs.delete(id);
  if (wasActive) {
    activeJobId = null;
    closeJobEvents();
    resetDetailState();
  }
  const remaining = [...jobs.keys()];
  if (wasActive && remaining.length > 0) selectJob(remaining[remaining.length - 1]);
  persistJobs();
  persistDrafts();
  renderJobsList();
}

function jobStatusText(snap) {
  if (snap.status === "running" && snap.paused) return "Paused";
  if (snap.status === "complete") return "✓ Done";
  if (snap.status === "failed") return "Failed";
  return snap.status;
}

function jobRowMeta(snap) {
  const total = snap.totalChapters || 0;
  const done = snap.completedChapters ?? 0;
  if (snap.status === "complete") return `${total} chapters`;
  if (snap.status === "failed") return snap.error || "Failed";
  if (snap.currentChapter === null || snap.currentChapter === undefined) {
    if (snap.phase === "discovering") return "Locating chapters…";
    return total > 0 ? `${done} / ${total} chapters` : "Preparing…";
  }
  if (total === 0) return currentChapterText(snap);
  return `${currentChapterText(snap)} / Max chap ${maxChapterNumber(snap)}`;
}

function renderThrottleStatus(snap) {
  const throttle = snap?.throttle;
  if (!throttleStatusBox) return;
  if (!throttle) {
    hide(throttleStatusBox);
    return;
  }
  show(throttleStatusBox);
  if (throttleProfileLabel) throttleProfileLabel.textContent = throttle.label || "Balanced";
  if (throttleDetailLabel) {
    throttleDetailLabel.textContent =
      `${throttle.effectiveConcurrency} chapters · ${throttle.effectiveImageConcurrency} images/host · ${throttle.pageDelayMs}ms`;
  }
  if (throttleCooldownLabel) {
    const cooling = Boolean(throttle.rateLimited || throttle.cooldownRemainingMs > 0);
    throttleCooldownLabel.classList.toggle("hidden", !cooling);
    throttleCooldownLabel.textContent = throttle.cooldownRemainingMs > 0
      ? `Cooling down ${Math.ceil(throttle.cooldownRemainingMs / 1000)}s…`
      : "Backing off";
  }
}

function renderJobsList() {
  const activeStates = [...jobs.values()].filter((state) => state.snap?.status !== "complete");
  if (activeStates.length === 0) {
    jobsListBox.innerHTML = '<div class="jobs-empty">No exports yet.</div>';
    if (throttleStatusBox) hide(throttleStatusBox);
    renderArchive();
    return;
  }
  const rows = [];
  for (const state of activeStates) {
    const snap = state.snap;
    const id = state.id;
    let title;
    let statusText;
    let statusClass = "";
    let meta;
    let pct = 0;
    let showBar = false;
    const actions = [];

    if (state.draft) {
      title = state.title || "New Job";
      statusText = state.phase === "error" ? "Error" : "Not started";
      statusClass = "draft";
      meta = state.error || (state.url ? `${hostLabel(state.url)}${state.chapterCount ? ` · ${state.chapterCount} chapters` : ""}` : "Add a link to begin");
    } else {
      title = snap?.title || snap?.slug || "Untitled export";
      const status = snap?.status || "queued";
      statusText = snap ? jobStatusText(snap) : "Queued";
      statusClass = snap?.paused ? "paused" : status === "complete" ? "done" : status === "failed" ? "failed" : "";
      meta = snap ? jobRowMeta(snap) : "Waiting for status…";
      pct = snap?.totalChapters
        ? Math.min(1, (snap.completedChapters || 0) / snap.totalChapters) * 100
        : 0;
      showBar = status === "running";
      const jobDownloads = detailDownloads(snap);
      actions.push(downloadActionHtml(jobDownloads, "download", id, "job-row-download"));
      if (status === "running") {
        actions.push(`<button type="button" class="job-row-pause" data-pause="${escapeHtml(id)}">${snap?.userPaused ? "Resume" : "Pause"}</button>`);
      }
      if (status === "failed" && snap?.resumable) {
        actions.push(`<button type="button" class="job-row-pause" data-resume="${escapeHtml(id)}">Resume</button>`);
      }
    }

    actions.push(`<button type="button" class="job-row-archive" data-archive="${escapeHtml(id)}" aria-label="Archive job" title="Archive job">×</button>`);
    rows.push(`<div class="job-row${id === activeJobId ? " selected" : ""}" data-id="${escapeHtml(id)}" role="button" tabindex="0">
      <div class="job-row-top">
        <span class="job-row-title" title="${escapeHtml(title)}">${escapeHtml(title)}</span>
        <span class="job-row-status ${statusClass}">${escapeHtml(statusText)}</span>
      </div>
      <div class="job-row-meta">${escapeHtml(meta)}</div>
      ${showBar ? `<div class="bar"><div class="bar-fill" style="width:${pct.toFixed(1)}%"></div></div>` : ""}
      <div class="job-row-actions">${actions.join("")}</div>
    </div>`);
  }
  jobsListBox.innerHTML = rows.join("");

  for (const row of jobsListBox.querySelectorAll(".job-row")) {
    row.addEventListener("click", () => selectJob(row.dataset.id));
    row.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        selectJob(row.dataset.id);
      }
    });
  }
  for (const button of jobsListBox.querySelectorAll("[data-pause]")) {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (activeJobId !== button.dataset.pause) selectJob(button.dataset.pause);
      await toggleJobPause();
    });
  }
  for (const button of jobsListBox.querySelectorAll("[data-resume]")) {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      if (activeJobId !== button.dataset.resume) selectJob(button.dataset.resume);
      await continueJob(button.dataset.resume);
    });
  }
  for (const link of jobsListBox.querySelectorAll("[data-download]")) {
    link.addEventListener("click", (event) => {
      event.stopPropagation();
      archiveJob(link.dataset.download);
    });
  }
  for (const button of jobsListBox.querySelectorAll("[data-archive]")) {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      await archiveJob(button.dataset.archive, { pause: true });
    });
  }
  renderArchive();
}

function selectJob(id) {
  if (!jobs.has(id)) return;
  const changed = activeJobId !== id;
  activeJobId = id;
  activeArchiveId = null;
  persistJobs();
  if (changed) {
    closeJobEvents();
    resetDetailState();
  }
  const state = jobs.get(id);
  if (state.draft) {
    resetDetailState();
    if (changed) hydrateDraftIntoComposer(state);
    renderJobsList();
    return;
  }
  if (changed) {
    settings = { ...DEFAULT_SETTINGS };
    draftSettings = { ...settings };
    resetSettingsApplied();
    renderSettings();
  }
  if (state.snap) {
    renderDetail(state.snap, state);
    renderThrottleStatus(state.snap);
  }
  renderJobsList();
  if (state.snap?.status === "running" && (!jobEventSource || changed)) connectJobEvents(id);
}

function handleSnapshot(snap) {
  const state = jobState(snap.id);
  const previousStatus = state.status;
  state.snap = snap;
  state.status = snap.status;
  updateSeriesFromSnapshot(snap);
  updateArchiveFromSnapshot(snap);
  if (previousStatus !== "failed" && snap.status === "failed") {
    setError(snap.error || "Job failed.");
  } else if (previousStatus === "failed" && snap.status !== "failed") {
    clearError();
  }
  if (activeJobId === snap.id) renderDetail(snap, state);
  renderThrottleStatus(snap);
  renderJobsList();
  if (snap.status !== "running" && activeJobId === snap.id) closeJobEvents();
}

async function fetchJobSnapshot(id) {
  if (jobs.get(id)?.draft) return;
  let res;
  try {
    res = await fetch(`/api/jobs/${id}`);
  } catch (err) {
    debugClient("warn", `Poll failed for ${id}: ${err.message}`);
    return;
  }
  if (res.status === 404) {
    removeJob(id);
    return;
  }
  if (!res.ok) {
    debugClient("warn", `GET /api/jobs/${id} responded ${res.status}`);
    return;
  }
  try {
    handleSnapshot(await res.json());
  } catch (err) {
    debugClient("warn", `Bad snapshot for ${id}: ${err.message}`);
  }
}

function ensurePolling() {
  if (jobsPollTimer) clearTimeout(jobsPollTimer);
  const pollable = [...jobs.values()].filter((state) => !state.draft);
  if (pollable.length === 0) {
    jobsPollTimer = null;
    return;
  }
  const hasActive = pollable.some((state) => !state.snap || state.snap.status === "running");
  jobsPollTimer = setTimeout(pollAllJobs, hasActive ? 1000 : 3000);
}

async function pollAllJobs() {
  if (pollingJobs) {
    ensurePolling();
    return;
  }
  pollingJobs = true;
  try {
    await Promise.all(
      [...jobs.values()].filter((state) => !state.draft).map((state) => fetchJobSnapshot(state.id)),
    );
  } finally {
    pollingJobs = false;
    ensurePolling();
  }
}

function connectJobEvents(jobId) {
  closeJobEvents();
  if (!window.EventSource) return;
  const source = new EventSource(`/api/jobs/${jobId}/events`);
  source.onmessage = (event) => {
    let snap;
    try {
      snap = JSON.parse(event.data);
    } catch {
      return;
    }
    handleSnapshot(snap);
  };
  source.onerror = () => {
    source.close();
    if (jobEventSource === source) jobEventSource = null;
  };
  jobEventSource = source;
}

function closeJobEvents() {
  if (jobEventSource) {
    jobEventSource.close();
    jobEventSource = null;
  }
}

async function toggleJobPause() {
  if (!activeJobId) return;
  const snap = jobs.get(activeJobId)?.snap;
  if (!snap || snap.status !== "running") return;
  const action = snap.userPaused ? "resume" : "pause";
  pauseBtn.disabled = true;
  try {
    const res = await fetch(`/api/jobs/${activeJobId}/${action}`, { method: "POST" });
    const updated = await readJson(res);
    if (!res.ok) {
      setError(updated.error || `Could not ${action} job.`);
      return;
    }
    handleSnapshot(updated);
  } catch (err) {
    debugClient("error", `POST /api/jobs/${activeJobId}/${action}: ${err.message}`);
    setError(`Network error while trying to ${action} the job.`);
  } finally {
    pauseBtn.disabled = false;
  }
}

async function startJob(payload) {
  const draftId = activeDraft()?.id || null;
  const draftState = draftId ? jobs.get(draftId) : null;
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";
  let started = false;

  try {
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await readJson(res);
    if (!res.ok) {
      const draft = draftId ? jobs.get(draftId) : null;
      if (draft?.draft) {
        draft.phase = "error";
        draft.error = body.error || "Could not start export.";
        syncActiveDraft();
      }
      handleErrorResponse(res, body);
      return;
    }
    hide(firstChapterBox);
    hide(sourcesPanel);
    const id = body.jobId;
    rememberSeriesStart(
      payload,
      pendingDiscovery?.chapterNumbers || payload.includeChapterKeys || [],
    );
    captureArchiveStart(id, payload, draftState);
    if (draftId && jobs.get(draftId)?.draft) convertDraftToServerJob(draftId, id);
    else jobState(id);
    selectJob(id);
    await fetchJobSnapshot(id);
    ensurePolling();
    started = true;
  } catch (err) {
    const draft = draftId ? jobs.get(draftId) : null;
    if (draft?.draft) {
      draft.phase = "error";
      draft.error = "Network error while starting the job.";
      syncActiveDraft();
    }
    debugClient("error", `POST /api/scrape: ${err.message}`);
    setError("Network error while starting the job.");
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Find chapters";
  }
  return started;
}

async function pollDebug() {
  try {
    const res = await fetch("/api/debug/log");
    if (!res.ok) return;
    const body = await res.json();
    for (const entry of body.entries || []) {
      if (!entry || entry.id <= lastDebugId) continue;
      lastDebugId = entry.id;
      const time = new Date(entry.at).toLocaleTimeString();
      appendDebug(entry.level, `[server ${time}] ${entry.message}`);
    }
  } catch {}
}

function connectDebugEvents() {
  if (!window.EventSource) {
    debugPollTimer = setInterval(pollDebug, 1000);
    return;
  }
  const source = new EventSource("/api/debug/events");
  source.onmessage = (event) => {
    let entry;
    try {
      entry = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!entry || entry.id <= lastDebugId) return;
    lastDebugId = entry.id;
    const time = new Date(entry.at).toLocaleTimeString();
    appendDebug(entry.level, `[server ${time}] ${entry.message}`);
  };
  source.onerror = () => {
    source.close();
    if (!debugPollTimer) debugPollTimer = setInterval(pollDebug, 1000);
  };
  debugEventSource = source;
}

connectDebugEvents();
renderArchive();
restoreJobs();

function renderSources(data) {
  sourceState = {
    token: data.discoveryToken,
    order: [...(data.defaults?.sourceOrder || [])],
    enabled: new Set(data.defaults?.enabledSourceIds || []),
    overrides: { ...(data.defaults?.chapterOverrides || {}) },
    providers: new Map(data.providers.map((provider) => [provider.id, provider])),
    chapters: data.chapters || [],
    defaults: data.defaults || {},
  };
  initializePartState(sourceState);
  sourcesTitle.textContent = data.title || "this series";
  sourcesSummary.textContent = `${sourceState.chapters.length} chapters · ${data.providers.length} providers`;
  renderSourceList();
  renderChapterSourceList();
}

function renderSourceList() {
  const order = sourceState.order;
  let html = "";
  for (let i = 0; i < order.length; i++) {
    const provider = sourceState.providers.get(order[i]);
    if (!provider) continue;
    html += `<div class="source-row">
      <label>
        <input type="checkbox" data-source="${escapeHtml(provider.id)}" ${sourceState.enabled.has(provider.id) ? "checked" : ""} />
        <span>
          <span class="source-name">${escapeHtml(provider.name)}</span>
          <span class="source-meta">${provider.chapterCount} chapters · score ${provider.score}</span>
        </span>
      </label>
      <div class="source-moves">
        <button type="button" class="source-move" data-move="up" data-index="${i}" ${i === 0 ? "disabled" : ""} aria-label="Move ${escapeHtml(provider.name)} up">↑</button>
        <button type="button" class="source-move" data-move="down" data-index="${i}" ${i === order.length - 1 ? "disabled" : ""} aria-label="Move ${escapeHtml(provider.name)} down">↓</button>
      </div>
    </div>`;
  }
  sourceListBox.innerHTML = html;

  for (const input of sourceListBox.querySelectorAll('input[type="checkbox"]')) {
    input.addEventListener("change", () => {
      if (input.checked) sourceState.enabled.add(input.dataset.source);
      else sourceState.enabled.delete(input.dataset.source);
      renderChapterSourceList();
    });
  }
  for (const button of sourceListBox.querySelectorAll(".source-move")) {
    button.addEventListener("click", () => {
      const i = Number(button.dataset.index);
      const j = button.dataset.move === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= order.length) return;
      [order[i], order[j]] = [order[j], order[i]];
      renderSourceList();
      renderChapterSourceList();
    });
  }
  syncActiveDraft();
}

function orderedProviderIds() {
  const ids = [...sourceState.order];
  for (const provider of sourceState.providers.values()) {
    if (!ids.includes(provider.id)) ids.push(provider.id);
  }
  return ids;
}

function defaultProviderFor(group) {
  const ids = orderedProviderIds();
  for (const id of ids) {
    if (sourceState.enabled.has(id) && group.options.some((option) => option.providerId === id)) {
      return id;
    }
  }
  return group.options.find((option) => ids.includes(option.providerId))?.providerId || group.options[0]?.providerId || "";
}

function renderSourceSelect(group, prefix = "", disabled = false) {
  const ids = orderedProviderIds();
  const key = group.key || String(group.number);
  const selected = sourceState.overrides[key] ?? defaultProviderFor(group);
  const options = ids
    .map((id) => group.options.find((option) => option.providerId === id))
    .filter(Boolean)
    .concat(group.options.filter((option) => !ids.includes(option.providerId)));
  const optionHtml = options
    .map((option) => {
      const name = option.providerName || sourceState.providers.get(option.providerId)?.name || option.providerId;
      const suffix = sourceState.enabled.has(option.providerId) ? "" : " (disabled)";
      return `<option value="${escapeHtml(option.providerId)}" ${option.providerId === selected ? "selected" : ""}>${escapeHtml(name + suffix)}</option>`;
    })
    .join("");
  return `<div class="chapter-source-row${disabled ? " disabled" : ""}">
    <span>${prefix}${group.number === 0 ? "Prologue" : `Ch. ${group.number}`}</span>
    <select data-chapter="${escapeHtml(key)}" ${disabled ? "disabled" : ""}>${optionHtml}</select>
  </div>`;
}

function renderChapterSourceList() {
  let html = "";
  for (const group of sourceState.chapters) {
    if (group.combined) {
      const partsText = group.parts.map((part) => part.number).join(" + ");
      html += `<div class="chapter-source-row combined-title"><span><b>Ch. ${group.number} (combined)</b> — ${escapeHtml(partsText)}</span></div>`;
      for (const part of group.parts) {
        html += renderSourceSelect(part, "↳ ", !isPartEnabled(part.key));
      }
    } else {
      html += renderSourceSelect(group);
    }
  }
  chapterSourceListBox.innerHTML = html;

  for (const select of chapterSourceListBox.querySelectorAll("select")) {
    select.addEventListener("change", () => {
      sourceState.overrides[select.dataset.chapter] = select.value;
      syncActiveDraft();
    });
  }
  syncActiveDraft();
}

async function updateSeries(urlOverride, options = {}) {
  const url = (urlOverride || urlInput.value).trim();
  if (!url) {
    setError("Paste a series link first.");
    return;
  }
  const key = options.seriesKey || seriesKeyFromUrl(url);
  const values = updateSettings(options.settings || settings);
  if (options.settings) {
    settings = values;
    draftSettings = { ...values };
    renderSettings();
  }
  const record = getSeriesRecord(key) || {
    key,
    url,
    title: options.title || draftTitleFromUrl(url),
    expectedChapterKeys: [],
    knownChapterKeys: [],
    downloadedChapterKeys: [],
  };
  if (autoDiscoverTimer) clearTimeout(autoDiscoverTimer);
  const generation = ++discoveryGeneration;
  archiveRerun = null;
  activeArchiveId = null;
  clearError();
  debugClient("info", `Checking for new chapters: ${url}`);
  try {
    let result = options.discoveryResult || null;
    if (!result) {
      const res = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requestBody({ url }, values)),
      });
      result = await readJson(res);
      if (generation !== discoveryGeneration) return;
      if (!res.ok) {
        handleErrorResponse(res, result);
        return;
      }
    }
    if (generation !== discoveryGeneration) return;

    const expected = expectedKeysFromDiscovery(result);
    rememberSeriesDiscovery({
      key,
      url,
      title: result.title || options.title || hostLabel(url),
      chapterNumbers: expected,
    });
    const current = getSeriesRecord(key) || record;
    const downloaded = new Set([
      ...(current.downloadedChapterKeys || []),
      ...collectArchiveDownloadedKeys(key),
    ]);
    const known = new Set([...(current.knownChapterKeys || []), ...downloaded]);
    const gaps = seriesGapsFor(key, expected);
    const newKeys = options.includeKeys
      ? uniqueChapterNumbers(options.includeKeys)
      : uniqueChapterNumbers([
          ...expected.filter((number) => !known.has(number)),
          ...gaps,
        ]);

    if (newKeys.length === 0) {
      const message = `No new chapters found${options.title ? ` for ${options.title}` : ""}`;
      debugClient("info", message);
      showTemporaryDetailStatus("Already up to date");
      return;
    }

    debugClient("info", `Starting ${newKeys.length} chapter${newKeys.length === 1 ? "" : "s"}…`);
    const draft = createDraftJob({ select: true });
    draft.url = url;
    draft.seriesKey = key;
    draft.settings = { ...values };
    urlInput.value = url;
    pendingDiscovery = result;
    const detectedCoverUrl = isValidHttpUrl(result.coverUrl || "") ? result.coverUrl : "";
    const savedCover = isValidHttpUrl(current.coverUrl || "") ? current.coverUrl : null;
    reviewState = {
      token: result.discoveryToken,
      chapters: (result.chapters || []).map((chapter) => ({ ...chapter })),
      overrides: {},
      detectedCoverUrl,
      appliedCoverUrl: savedCover,
      coverToken: current.coverToken || null,
    };
    sourceState = null;
    detectedKind.textContent = kindLabel(result.detectedKind);
    show(detectedBox);
    hide(firstChapterBox);
    hide(sourceControls);
    hide(sourcesAuto);
    hide(sourcesPanel);
    reviewCoverUrlInput.value = savedCover || detectedCoverUrl;
    setCoverApplyStatus(
      reviewState.coverToken
        ? "Saved cover upload applied"
        : savedCover
          ? "Saved cover applied"
          : detectedCoverUrl
            ? "Detected cover applied"
            : "No cover found",
      Boolean(reviewState.coverToken || savedCover || detectedCoverUrl),
    );
    syncActiveDraft();

    const payload = buildScrapePayload({ includeChapterKeys: newKeys, seriesKey: key });
    const started = await startJob(payload);
    if (started && options.archiveCacheKey) {
      const cached = archiveDiscoveryCache.get(options.archiveCacheKey);
      if (cached) {
        cached.state = "upToDate";
        cached.newKeys = [];
        cached.checkedAt = Date.now();
      }
    }
    if (started) {
      debugClient("info", `Started ${newKeys.length} chapter${newKeys.length === 1 ? "" : "s"}`);
    }
  } catch (err) {
    if (generation !== discoveryGeneration) return;
    debugClient("error", `Series update failed: ${err.message}`);
    setError("Network error while checking for new chapters.");
  }
}

async function continueJob(id = activeJobId) {
  if (!id) return;
  resumeBtn.disabled = true;
  resumeBtn.textContent = "Resuming…";
  try {
    const res = await fetch(`/api/jobs/${id}/continue`, { method: "POST" });
    const body = await readJson(res);
    if (!res.ok) {
      setError(body.error || "Could not resume that job.");
      return;
    }
    hide(downloadBox);
    hide(retryBox);
    hide(resumeBox);
    clearError();
    await fetchJobSnapshot(id);
    selectJob(id);
    ensurePolling();
  } catch (err) {
    debugClient("error", `Resume request failed: ${err.message}`);
    setError("Network error while resuming.");
  } finally {
    resumeBtn.disabled = false;
    resumeBtn.textContent = "Resume from last completed chapter";
  }
}

function openRetryModal() {
  if (!activeJobId) return;
  const snap = jobs.get(activeJobId)?.snap;
  if (!snap) return;
  if (snap.tempCleaned) {
    retryJob([], true);
    return;
  }
  const retryable = snap.retryable || [];
  if (retryable.length === 0) return;
  const chapters = snap.chapters || [];
  retryListBox.innerHTML = retryable
    .map((number) => {
      const chapter = chapters.find(
        (entry) => Number(entry.chapter) === Number(number) || Number(entry.number) === Number(number),
      );
      const label = chapter?.label ?? number;
      const reason = chapter?.reason || "failed";
      return `<label class="retry-row"><input type="checkbox" value="${escapeHtml(number)}" checked /><span>${escapeHtml(/^(chapter|prologue)\b/i.test(String(label)) ? label : `Chapter ${label}`)}<small>${escapeHtml(reason)}</small></span></label>`;
    })
    .join("");
  show(retryModal);
  retrySelectedBtn.focus();
}

function closeRetryModal() {
  hide(retryModal);
}

async function retryJob(chapterKeys = null, rebuild = false) {
  if (!activeJobId) return;
  const jobId = activeJobId;
  retryBtn.disabled = true;
  retryBtn.textContent = "Retrying…";
  retrySelectedBtn.disabled = true;
  try {
    const body = rebuild || !chapterKeys || chapterKeys.length === 0
      ? undefined
      : { chapterKeys };
    const res = await fetch(`/api/jobs/${jobId}/retry`, {
      method: "POST",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const result = await readJson(res);
    if (!res.ok) {
      debugClient("error", `Retry responded ${res.status}: ${result.error || "unknown error"}`);
      setError(result.error || "Could not retry.");
      return;
    }
    closeRetryModal();
    hide(downloadBox);
    hide(retryBox);
    hide(resumeBox);
    clearError();
    await fetchJobSnapshot(jobId);
    selectJob(jobId);
    ensurePolling();
  } catch (err) {
    debugClient("error", `Retry request failed: ${err.message}`);
    setError("Network error while retrying.");
  } finally {
    retryBtn.disabled = false;
    retryBtn.textContent = "Retry failed chapters";
    retrySelectedBtn.disabled = false;
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  if (autoDiscoverTimer) clearTimeout(autoDiscoverTimer);
  archiveRerun = null;
  startScrape();
});

urlInput.addEventListener("input", scheduleAutoDiscovery);

archiveToggle?.addEventListener("click", () => {
  const willOpen = archiveListBox.classList.contains("hidden");
  if (willOpen) show(archiveListBox);
  else hide(archiveListBox);
  archiveToggle.setAttribute("aria-expanded", String(willOpen));
});

archiveDeleteCancel?.addEventListener("click", () => closeArchiveDeleteModal());
archiveDeleteConfirm?.addEventListener("click", () => {
  if (!pendingArchiveDeleteId) return;
  deleteArchivedJob(pendingArchiveDeleteId);
  closeArchiveDeleteModal();
});
archiveDeleteModal?.addEventListener("click", (event) => {
  if (event.target === archiveDeleteModal) closeArchiveDeleteModal();
});

jobsNewBtn.addEventListener("click", () => {
  if (autoDiscoverTimer) clearTimeout(autoDiscoverTimer);
  archiveRerun = null;
  activeArchiveId = null;
  discoveryGeneration += 1;
  clearError();
  resetComposer();
  urlInput.value = "";
  createDraftJob();
  urlInput.focus();
});

pauseBtn.addEventListener("click", () => toggleJobPause());

firstChapterForm.addEventListener("submit", (e) => {
  e.preventDefault();
  const fc = firstChapterUrlInput.value.trim();
  if (!fc) return;
  firstChapterBtn.disabled = true;
  firstChapterBtn.textContent = "Retrying…";
  startScrape(fc).finally(() => {
    firstChapterBtn.disabled = false;
    firstChapterBtn.textContent = "Continue";
  });
});

addChapterForm.addEventListener("submit", addReviewChapter);
addChapterUrlInput.addEventListener("input", applyDetectedChapterNumber);
addChapterNumberInput.addEventListener("input", () => {
  addChapterNumberAutoFilled = false;
});
window.addEventListener("resize", fitSourceTitle);

coverApplyBtn.addEventListener("click", applyCoverUrl);
reviewCoverUrlInput.addEventListener("input", () => {
  if (!reviewState) return;
  if (errorBox.textContent.includes("Cover image URL")) clearError();
  reviewState.appliedCoverUrl = null;
  const value = reviewCoverUrlInput.value.trim();
  const detected = reviewState.detectedCoverUrl || "";
  if (value && value === detected) {
    setCoverApplyStatus("Detected cover applied", true);
  } else if (value) {
    setCoverApplyStatus("Click Apply to use this URL", false);
  } else {
    setCoverApplyStatus(detected ? "Using detected cover" : "No cover", Boolean(detected));
  }
  syncActiveDraft();
});

sourcesAuto.addEventListener("click", () => {
  if (!pendingDiscovery || !sourceState) return;
  const defaults = pendingDiscovery.defaults || {};
  sourceState.order = [...(defaults.sourceOrder || [])];
  sourceState.enabled = new Set(defaults.enabledSourceIds || []);
  sourceState.overrides = {};
  sourceState.defaults = defaults;
  initializePartState(sourceState);
  renderSourceList();
  renderReviewChapters();
  renderChapterSourceList();
});

sourcesCancel.addEventListener("click", () => {
  if (autoDiscoverTimer) clearTimeout(autoDiscoverTimer);
  discoveryGeneration += 1;
  hide(sourcesPanel);
  hide(sourceControls);
  hide(detectedBox);
  reviewListBox.innerHTML = "";
  reviewCoverUrlInput.value = "";
  setCoverApplyStatus("", false);
  if (coverFileInput) coverFileInput.value = "";
  if (coverPreview) {
    coverPreview.removeAttribute("src");
    coverPreview.classList.add("hidden");
  }
  if (coverUploadStatus) {
    coverUploadStatus.textContent = "";
    coverUploadStatus.classList.remove("applied");
  }
  urlInput.value = "";
  pendingDiscovery = null;
  reviewState = null;
  sourceState = null;
  startBtn.disabled = false;
  startBtn.textContent = "Find chapters";
  syncActiveDraft();
});

sourcesStart.addEventListener("click", () => {
  if (!reviewState) return;
  if (!reviewState.token) {
    setError("This chapter preview expired. Search again.");
    return;
  }
  syncActiveDraft();

  let payload;
  try {
    payload = buildScrapePayload();
  } catch (err) {
    setError(err.message);
    openSettings();
    return;
  }
  hide(sourcesPanel);
  startJob(payload);
});

retryBtn.addEventListener("click", () => openRetryModal());
retryCancelBtn.addEventListener("click", () => closeRetryModal());
retrySelectedBtn.addEventListener("click", () => {
  const chapterKeys = [...retryListBox.querySelectorAll('input[type="checkbox"]:checked')].map((input) =>
    Number(input.value),
  );
  if (chapterKeys.length === 0) {
    setError("Select at least one chapter to retry.");
    return;
  }
  retryJob(chapterKeys);
});
resumeBtn.addEventListener("click", () => continueJob());
coverFileInput.addEventListener("change", () => {
  const file = coverFileInput.files?.[0];
  uploadCoverFile(file).finally(() => {
    coverFileInput.value = "";
  });
});
detailGapsBtn.addEventListener("click", () => {
  if (!currentDetailGapKeys.length) return;
  const snap = jobs.get(activeJobId)?.snap || archiveRecord(activeArchiveId)?.detail;
  const url = archiveRecord(activeArchiveId)?.url || jobs.get(activeJobId)?.url || urlInput.value;
  updateSeries(url, {
    title: snap?.title || archiveRecord(activeArchiveId)?.title,
    seriesKey: snap?.seriesKey || seriesKeyFromUrl(url),
    settings: archiveRecord(activeArchiveId)?.settings,
    includeKeys: currentDetailGapKeys,
  });
});
for (const link of [downloadLink, downloadCbzLink]) {
  link?.addEventListener("click", () => {
    if (activeJobId && !jobs.get(activeJobId)?.draft) archiveJob(activeJobId);
  });
}
debugClearBtn.addEventListener("click", () => {
  debugLogBox.innerHTML = "";
});
