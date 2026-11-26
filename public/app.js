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

const settingsBtn = document.getElementById("settings-btn");
const settingsMenu = document.getElementById("settings-menu");
const settingsClose = document.getElementById("settings-close");
const settingsApply = document.getElementById("settings-apply");
const startChapterInput = document.getElementById("start-chapter");
const endChapterInput = document.getElementById("end-chapter");
const settingsModal = document.getElementById("settings-modal");
const settingsModalConfirm = document.getElementById("settings-modal-confirm");
const settingsModalCancel = document.getElementById("settings-modal-cancel");

const SETTINGS_KEY = "manhwa-downloader-settings";
const DEFAULT_SETTINGS = {
  startChapter: "",
  endChapter: "",
  concurrency: "auto",
  delay: "auto",
};

let settings = loadSettings();
let draftSettings = { ...settings };
let pollTimer = null;
let jobEventSource = null;
let debugEventSource = null;
let debugPollTimer = null;
let pendingConcurrency = null;
let pendingDiscovery = null;
let sourceState = null;
let seenLogs = 0;
let lastJobLogId = 0;
let activeJobId = null;
let lastDebugId = 0;
let lastPollErrorAt = 0;
const chapterRows = new Map();

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}");
    return { ...DEFAULT_SETTINGS, ...saved };
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
  pendingDiscovery = null;
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

  let handedOff = false;
  startBtn.disabled = true;
  startBtn.textContent = "Detecting…";

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

    if (!result.supported) {
      handedOff = true;
      startJob(body);
      return;
    }

    pendingDiscovery = result;
    for (const line of result.log || []) debugClient("info", `discovery: ${line}`);
    renderSources(result);
    show(sourcesPanel);
  } catch (err) {
    debugClient("error", `POST /api/discover: ${err.message}`);
    setError("Network error while checking sources.");
  } finally {
    if (!handedOff) {
      startBtn.disabled = false;
      startBtn.textContent = "Start";
    }
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
    startBtn.textContent = "Start";
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
  };
  sourcesTitle.textContent = `Sources for ${data.title || "this series"}`;
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

function renderSourceSelect(group, prefix = "") {
  const ids = orderedProviderIds();
  const selected = sourceState.overrides[String(group.number)] ?? defaultProviderFor(group);
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
  return `<div class="chapter-source-row">
    <span>${prefix}${group.number === 0 ? "Prologue" : `Ch. ${group.number}`}</span>
    <select data-chapter="${escapeHtml(group.number)}">${optionHtml}</select>
  </div>`;
}

function renderChapterSourceList() {
  let html = "";
  for (const group of sourceState.chapters) {
    if (group.combined) {
      const partsText = group.parts.map((part) => part.number).join(" + ");
      html += `<div class="chapter-source-row"><span><b>Ch. ${group.number} (combined)</b> — ${escapeHtml(partsText)}</span><span></span></div>`;
      for (const part of group.parts) html += renderSourceSelect(part, "↳ ");
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

sourcesAuto.addEventListener("click", () => {
  if (!pendingDiscovery) return;
  sourceState.order = [...(pendingDiscovery.defaults?.sourceOrder || [])];
  sourceState.enabled = new Set(pendingDiscovery.defaults?.enabledSourceIds || []);
  sourceState.overrides = {};
  renderSourceList();
  renderChapterSourceList();
});

sourcesCancel.addEventListener("click", () => {
  hide(sourcesPanel);
  pendingDiscovery = null;
  sourceState = null;
  startBtn.disabled = false;
  startBtn.textContent = "Start";
});

sourcesStart.addEventListener("click", () => {
  if (!sourceState) return;
  let payload;
  try {
    payload = requestBody({
      discoveryToken: sourceState.token,
      sourceOrder: [...sourceState.order],
      enabledSourceIds: [...sourceState.enabled],
      chapterOverrides: { ...sourceState.overrides },
    });
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
