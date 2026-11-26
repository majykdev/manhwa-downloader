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

const SETTINGS_KEY = "manhwa-downloader-settings";
const DEFAULT_SETTINGS = {
  startChapter: "",
  endChapter: "",
  concurrency: "auto",
  delay: "auto",
  chapterHyperlinks: true,
};

let settings = loadSettings();
let draftSettings = { ...settings };
let pollTimer = null;
let jobEventSource = null;
let debugEventSource = null;
let debugPollTimer = null;
let pendingConcurrency = null;
let pendingDiscovery = null;
let reviewState = null;
let sourceState = null;
let addChapterNumberAutoFilled = false;
let seenLogs = 0;
let lastJobLogId = 0;
let activeJobId = null;
let lastDebugId = 0;
let lastPollErrorAt = 0;
const chapterRows = new Map();

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

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    const loaded = { ...DEFAULT_SETTINGS, ...saved };
    loaded.chapterHyperlinks = loaded.chapterHyperlinks !== false;
    return loaded;
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings() {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

function renderSettings() {
  startChapterInput.value = draftSettings.startChapter ?? "";
  endChapterInput.value = draftSettings.endChapter ?? "";
  chapterHyperlinksToggle.setAttribute("aria-checked", String(draftSettings.chapterHyperlinks !== false));
  for (const key of ["concurrency", "delay"]) {
    const value = String(draftSettings[key] ?? "auto");
    const label = document.getElementById(`${key}-value`);
    if (label) label.textContent = value === "auto" ? "Auto" : key === "delay" ? `${value}ms` : value;
    for (const option of document.querySelectorAll(`[data-select="${key}"] .select-option`)) {
      option.setAttribute("aria-selected", String(option.dataset.value === value));
    }
  }
}

function openSettings() {
  draftSettings = { ...settings };
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
  renderSettings();
}

function commitSettings() {
  settings = { ...draftSettings };
  saveSettings();
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
  closeSettings();
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
startChapterInput.addEventListener("change", () => applySetting("startChapter", startChapterInput.value.trim()));
endChapterInput.addEventListener("change", () => applySetting("endChapter", endChapterInput.value.trim()));
chapterHyperlinksToggle.addEventListener("click", () => {
  applySetting("chapterHyperlinks", chapterHyperlinksToggle.getAttribute("aria-checked") !== "true");
});
setupCustomSelect("concurrency");
setupCustomSelect("delay");

document.addEventListener("click", (event) => {
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
  if (value) {
    setCoverApplyStatus(value === detected ? "Detected cover applied" : "Cover applied", true);
  } else {
    setCoverApplyStatus(detected ? "Using detected cover" : "No cover", Boolean(detected));
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

function readChapterRange() {
  const parse = (value, label) => {
    if (value === undefined || value === null || String(value).trim() === "") return null;
    const n = Number(value);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
      throw new Error(`${label} must be a whole chapter number of 0 or greater.`);
    }
    return n;
  };
  const startChapter = parse(settings.startChapter, "Start chapter");
  const endChapter = parse(settings.endChapter, "End chapter");
  if (startChapter !== null && endChapter !== null && startChapter > endChapter) {
    throw new Error("Start chapter cannot be greater than end chapter.");
  }
  return { startChapter, endChapter };
}

function requestBody(extra = {}) {
  const range = readChapterRange();
  return {
    ...range,
    settings: {
      concurrency: settings.concurrency,
      delay: settings.delay,
      chapterHyperlinks: settings.chapterHyperlinks !== false,
    },
    ...extra,
  };
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

function resetActivity() {
  seenLogs = 0;
  lastJobLogId = 0;
  logBox.innerHTML = "";
  chapterListBox.innerHTML = "";
  chapterRows.clear();
  hide(chapterListBox);
  hide(downloadBox);
  hide(retryBox);
  hide(firstChapterBox);
  hide(sourcesPanel);
  hide(progressBox);
  reviewListBox.innerHTML = "";
  reviewCoverUrlInput.value = "";
  setCoverApplyStatus("", false);
  pendingDiscovery = null;
  reviewState = null;
  sourceState = null;
  stats.innerHTML = "";
  closeJobEvents();
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

function renderLog(log) {
  if (!log || log.length === 0) return;
  show(logBox);
  for (const entry of log) {
    const message = typeof entry === "string" ? entry : entry.message;
    if (typeof entry === "object" && entry.id != null) {
      if (entry.id <= lastJobLogId) continue;
      lastJobLogId = entry.id;
    } else {
      if (seenLogs >= log.length) continue;
      seenLogs = log.length;
    }
    const cls = classify(message);
    const div = document.createElement("div");
    div.textContent = message;
    div.className = cls;
    logBox.appendChild(div);
    if (cls === "err" || cls === "warn") appendDebug(cls, `chapter: ${message}`);
  }
  logBox.scrollTop = logBox.scrollHeight;
}

function render(snap) {
  const total = snap.totalChapters || 0;
  const done = snap.completedChapters ?? 0;
  if (total > 0) {
    barFill.style.width = `${(Math.min(1, done / total) * 100).toFixed(1)}%`;
    barFill.style.animation = "";
    if (snap.status === "running") {
      if (snap.phase === "assembling") {
        statusLabel.textContent = "Assembling PDF…";
        chapterLabel.textContent = `${done} / ${total} chapters scraped`;
      } else if (snap.phase === "discovering") {
        statusLabel.innerHTML = `<span class="spin"></span> Locating chapters…`;
        chapterLabel.textContent = "";
      } else {
        statusLabel.innerHTML = `Downloading <b>chapter ${snap.currentChapter}</b>`;
        chapterLabel.textContent = `${done} / ${total} chapters`;
      }
    } else {
      statusLabel.textContent = snap.status;
      chapterLabel.textContent = `${total} chapters`;
    }
  } else {
    barFill.style.width = "100%";
    barFill.style.animation = "none";
    statusLabel.innerHTML = `<span class="spin"></span> Locating chapters…`;
    chapterLabel.textContent = "";
  }

  const badges = [];
  if (snap.pages) badges.push(`<span class="badge ok">${snap.pages} pages</span>`);
  if (snap.skipped) badges.push(`<span class="badge warn">${snap.skipped} skipped</span>`);
  if (snap.locked) badges.push(`<span class="badge warn">${snap.locked} locked</span>`);
  stats.innerHTML = badges.join(" ");

  renderChapters(snap.chapters || [], snap.currentChapter);
  renderLog(snap.log);

  if (snap.downloadUrl) {
    show(downloadBox);
    downloadLink.href = snap.downloadUrl;
    downloadLink.textContent = snap.partialDownload ? "Download partial PDF" : "Download PDF";
  } else {
    hide(downloadBox);
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

    const label = ch.prologue
      ? "Prologue"
      : `Chapter ${ch.label !== undefined && ch.label !== null ? ch.label : ch.chapter}`;
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

async function startScrape(firstChapterUrl) {
  clearError();
  resetActivity();

  const url = urlInput.value.trim();
  if (!url) return;

  let body;
  try {
    body = requestBody({ url, firstChapterUrl: firstChapterUrl || undefined });
  } catch (err) {
    setError(err.message);
    openSettings();
    return;
  }

  startBtn.disabled = true;
  startBtn.textContent = "Finding chapters…";

  try {
    const res = await fetch("/api/discover", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const result = await readJson(res);
    if (!res.ok) {
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
    renderReviewChapters();
    show(sourcesPanel);
    fitSourceTitle();
  } catch (err) {
    debugClient("error", `POST /api/discover: ${err.message}`);
    setError("Network error while finding chapters.");
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Find chapters";
  }
}

async function startJob(payload) {
  startBtn.disabled = true;
  startBtn.textContent = "Starting…";

  try {
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const body = await readJson(res);
    if (!res.ok) {
      handleErrorResponse(res, body);
      return;
    }
    hide(firstChapterBox);
    hide(sourcesPanel);
    activeJobId = body.jobId;
    show(progressBox);
    connectJobEvents(body.jobId);
    poll(body.jobId);
  } catch (err) {
    debugClient("error", `POST /api/scrape: ${err.message}`);
    setError("Network error while starting the job.");
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Find chapters";
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
    handleSnapshot(snap, jobId);
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

function handleSnapshot(snap, jobId) {
  render(snap);
  if (snap.status === "complete") {
    show(downloadBox);
    downloadLink.href = snap.downloadUrl || `/api/jobs/${jobId}/download`;
    downloadLink.textContent = "Download PDF";
    statusLabel.textContent = "Complete";
    if (snap.retryable && snap.retryable.length > 0) {
      show(retryBox);
      retryBtn.textContent = `Retry ${snap.retryable.length} failed chapter(s)`;
    } else {
      hide(retryBox);
    }
    closeJobEvents();
    return;
  }
  if (snap.status === "failed") {
    setError(snap.error || "Job failed.");
    statusLabel.textContent = "Failed";
    closeJobEvents();
    return;
  }
  hide(retryBox);
}

async function poll(jobId) {
  if (pollTimer) clearTimeout(pollTimer);
  let snap;
  try {
    const res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) {
      debugClient("error", `GET /api/jobs/${jobId} responded ${res.status}`);
      setError("Job no longer exists (it may have expired).");
      return;
    }
    snap = await res.json();
  } catch (err) {
    if (Date.now() - lastPollErrorAt > 10_000) {
      lastPollErrorAt = Date.now();
      debugClient("warn", `Poll failed: ${err.message}`);
    }
    pollTimer = setTimeout(() => poll(jobId), 1500);
    return;
  }

  handleSnapshot(snap, jobId);
  if (snap.status === "running") pollTimer = setTimeout(() => poll(jobId), 1000);
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
    });
  }
}

async function retryJob() {
  if (!activeJobId) return;
  retryBtn.disabled = true;
  retryBtn.textContent = "Retrying…";
  try {
    const res = await fetch(`/api/jobs/${activeJobId}/retry`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      debugClient("error", `Retry responded ${res.status}: ${body.error || "unknown error"}`);
      setError(body.error || "Could not retry.");
      retryBtn.disabled = false;
      retryBtn.textContent = "Retry failed chapters";
      return;
    }
    hide(downloadBox);
    hide(retryBox);
    clearError();
    connectJobEvents(activeJobId);
    poll(activeJobId);
  } catch (err) {
    debugClient("error", `Retry request failed: ${err.message}`);
    setError("Network error while retrying.");
    retryBtn.disabled = false;
    retryBtn.textContent = "Retry failed chapters";
  }
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  startScrape();
});

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
  hide(sourcesPanel);
  hide(sourceControls);
  hide(detectedBox);
  reviewListBox.innerHTML = "";
  reviewCoverUrlInput.value = "";
  setCoverApplyStatus("", false);
  urlInput.value = "";
  pendingDiscovery = null;
  reviewState = null;
  sourceState = null;
  startBtn.disabled = false;
  startBtn.textContent = "Find chapters";
});

sourcesStart.addEventListener("click", () => {
  if (!reviewState) return;
  if (!reviewState.token) {
    setError("This chapter preview expired. Search again.");
    return;
  }

  let payload;
  try {
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
    };
    if (sourceState) {
      extra.sourceOrder = [...sourceState.order];
      extra.enabledSourceIds = [...sourceState.enabled];
      extra.chapterOverrides = { ...sourceState.overrides };
      extra.excludedPartKeys = [...sourceState.disabledParts];
    }
    payload = requestBody(extra);
  } catch (err) {
    setError(err.message);
    openSettings();
    return;
  }
  hide(sourcesPanel);
  startJob(payload);
});

retryBtn.addEventListener("click", () => retryJob());
debugClearBtn.addEventListener("click", () => {
  debugLogBox.innerHTML = "";
});
