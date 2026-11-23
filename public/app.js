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

let pollTimer = null;
let seenLogs = 0;
let activeJobId = null;

function show(el) { el.classList.remove("hidden"); }
function hide(el) { el.classList.add("hidden"); }

function resetActivity() {
  seenLogs = 0;
  logBox.innerHTML = "";
  chapterListBox.innerHTML = "";
  hide(chapterListBox);
  hide(downloadBox);
  hide(retryBox);
  hide(firstChapterBox);
  stats.innerHTML = "";
}

function setError(msg) {
  errorBox.textContent = msg;
  show(errorBox);
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
  for (let i = seenLogs; i < log.length; i++) {
    const div = document.createElement("div");
    div.textContent = log[i];
    div.className = classify(log[i]);
    logBox.appendChild(div);
  }
  seenLogs = log.length;
  logBox.scrollTop = logBox.scrollHeight;
}

function render(snap) {
  if (snap.totalChapters) {
    const done = Math.max(0, Math.min(1, (snap.currentChapter ?? 0) / snap.totalChapters));
    barFill.style.width = `${(done * 100).toFixed(1)}%`;
    if (snap.status === "running") {
      statusLabel.innerHTML = `Downloading <b>chapter ${snap.currentChapter}</b>`;
      chapterLabel.textContent = `chapter ${snap.currentChapter} / ${snap.totalChapters}`;
    } else {
      statusLabel.textContent = snap.status;
      chapterLabel.textContent = `${snap.totalChapters} chapters`;
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
}

function renderChapters(chapters, activeChapter) {
  if (!chapters || chapters.length === 0) {
    chapterListBox.innerHTML = "";
    hide(chapterListBox);
    return;
  }
  show(chapterListBox);
  let html = "";
  for (const ch of chapters) {
    const isActive = ch.chapter === activeChapter;
    const label = ch.label !== undefined && ch.label !== null ? ch.label : ch.chapter;
    const barPct = ch.pagesTotal > 0 ? (ch.pagesDone / ch.pagesTotal * 100) : 0;
    let barHtml = "";
    if (ch.status === "scraping") {
      barHtml = `<div class="ch-bar"><div class="ch-bar-fill" style="width:${barPct.toFixed(1)}%"></div></div>`;
    } else if (ch.status === "done") {
      barHtml = `<div class="ch-bar"><div class="ch-bar-fill" style="width:100%"></div></div>`;
    } else {
      barHtml = `<div class="ch-bar"></div>`;
    }
    let statusText = ch.status;
    if (ch.status === "skipped" && ch.reason) statusText = ch.reason;
    if (ch.status === "scraping" && ch.pagesTotal > 0) statusText = `${ch.pagesDone}/${ch.pagesTotal}`;
    html += `<div class="ch-row${isActive ? " active" : ""}">
      <span class="ch-num">Chapter ${label}</span>
      ${barHtml}
      <span class="ch-status ${ch.status === "skipped" ? "skipped" : ch.status === "locked" ? "locked" : ch.status}">${statusText}</span>
    </div>`;
  }
  chapterListBox.innerHTML = html;
  const activeRow = chapterListBox.querySelector(".ch-row.active");
  if (activeRow) activeRow.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

async function startScrape(firstChapterUrl) {
  clearError();
  resetActivity();

  const url = urlInput.value.trim();
  if (!url) return;

  startBtn.disabled = true;
  startBtn.textContent = "Starting…";

  try {
    const res = await fetch("/api/scrape", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url, firstChapterUrl: firstChapterUrl || undefined }),
    });
    let body;
    try {
      body = await res.json();
    } catch {
      body = {};
    }
    if (!res.ok) {
      if (body.code === "NEED_FIRST_CHAPTER") {
        setError(body.error || "Could not find the first chapter.");
        show(firstChapterBox);
        firstChapterUrlInput.focus();
      } else {
        setError(body.error || "Failed to start job.");
      }
      return;
    }
    hide(firstChapterBox);
    activeJobId = body.jobId;
    show(progressBox);
    poll(body.jobId);
  } catch (err) {
    setError("Network error while starting the job.");
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Start";
  }
}

async function poll(jobId) {
  if (pollTimer) clearTimeout(pollTimer);
  let res, snap;
  try {
    res = await fetch(`/api/jobs/${jobId}`);
    if (!res.ok) {
      setError("Job no longer exists (it may have expired).");
      return;
    }
    snap = await res.json();
  } catch {
    pollTimer = setTimeout(() => poll(jobId), 1500);
    return;
  }

  render(snap);

  if (snap.status === "complete") {
    show(downloadBox);
    downloadLink.href = snap.downloadUrl;
    statusLabel.textContent = "Complete";
    if (snap.retryable && snap.retryable.length > 0) {
      show(retryBox);
      retryBtn.textContent = `Retry ${snap.retryable.length} failed chapter(s)`;
    } else {
      hide(retryBox);
    }
    return;
  }
  if (snap.status === "failed") {
    setError(snap.error || "Job failed.");
    statusLabel.textContent = "Failed";
    return;
  }
  if (snap.status === "running") {
    hide(downloadBox);
    hide(retryBox);
  }
  pollTimer = setTimeout(() => poll(jobId), 1500);
}

async function retryJob() {
  if (!activeJobId) return;
  retryBtn.disabled = true;
  retryBtn.textContent = "Retrying…";
  try {
    const res = await fetch(`/api/jobs/${activeJobId}/retry`, { method: "POST" });
    const body = await res.json();
    if (!res.ok) {
      setError(body.error || "Could not retry.");
      retryBtn.disabled = false;
      retryBtn.textContent = "Retry failed chapters";
      return;
    }
    hide(downloadBox);
    hide(retryBox);
    clearError();
    poll(activeJobId);
  } catch {
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

retryBtn.addEventListener("click", () => retryJob());
