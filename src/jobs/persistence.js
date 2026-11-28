"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const config = require("../config");

function createPersistence(dataDir = config.DATA_DIR) {
  const jobsDir = path.join(dataDir, "jobs");
  const uploadsDir = path.join(dataDir, "uploads");
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.mkdirSync(uploadsDir, { recursive: true });

  function jobPath(id) {
    return path.join(jobsDir, `${String(id).replace(/[^a-zA-Z0-9_-]/g, "")}.json`);
  }

  function uploadPath(token) {
    const safe = String(token || "").replace(/[^a-zA-Z0-9_-]/g, "");
    if (!safe) return null;
    return path.join(uploadsDir, `${safe}.jpg`);
  }

  function serializeJob(job) {
    return JSON.stringify(job, (key, value) => {
      if (key === "pauseWaiters") return [];
      return value;
    });
  }

  function saveJob(job) {
    if (!job || !job.id) return;
    const target = jobPath(job.id);
    const temp = `${target}.${process.pid}.${crypto.randomBytes(4).toString("hex")}.tmp`;
    fs.writeFileSync(temp, serializeJob(job));
    fs.renameSync(temp, target);
  }

  function loadJobs() {
    const jobs = [];
    for (const name of fs.readdirSync(jobsDir)) {
      if (!name.endsWith(".json")) continue;
      try {
        const job = JSON.parse(fs.readFileSync(path.join(jobsDir, name), "utf8"));
        if (!job || !job.id) continue;
        job.pauseWaiters = [];
        job.userPaused = false;
        job.downloadPaused = false;
        job.chapters ||= {};
        job.partialPaths ||= [];
        job.log ||= [];
        jobs.push(job);
      } catch {}
    }
    return jobs;
  }

  function deleteJob(id) {
    try {
      fs.rmSync(jobPath(id), { force: true });
    } catch {}
  }

  function saveCoverUpload(buffer) {
    const token = crypto.randomBytes(16).toString("hex");
    fs.writeFileSync(uploadPath(token), buffer);
    return token;
  }

  function getCoverPath(token) {
    const target = uploadPath(token);
    if (!target || !fs.existsSync(target)) return null;
    return target;
  }

  function deleteCoverUpload(token) {
    const target = uploadPath(token);
    if (!target) return;
    try {
      fs.rmSync(target, { force: true });
    } catch {}
  }

  return {
    dataDir,
    jobsDir,
    uploadsDir,
    jobPath,
    uploadPath,
    saveJob,
    loadJobs,
    deleteJob,
    saveCoverUpload,
    getCoverPath,
    deleteCoverUpload,
  };
}

module.exports = { createPersistence, persistence: createPersistence() };
