"use strict";

const fs = require("fs");
const archiver = require("archiver");
const sharp = require("sharp");

const FORMAT_EXTENSIONS = {
  jpeg: "jpg",
  jpg: "jpg",
  png: "png",
  webp: "webp",
  gif: "gif",
  avif: "avif",
  tiff: "tiff",
  tif: "tiff",
};

function formatExtension(format) {
  const key = String(format || "").trim().toLowerCase();
  return FORMAT_EXTENSIONS[key] || "jpg";
}

function chapterFolder(key, number) {
  const raw = Number(number ?? key);
  const value = Number.isFinite(raw) ? Math.max(0, Math.trunc(raw)) : key;
  return `Chapter ${String(value).padStart(3, "0")}`;
}

async function detectFormat(buffer) {
  try {
    const meta = await sharp(buffer).metadata();
    return meta.format;
  } catch {
    return "jpeg";
  }
}

class CbzBuilder {
  constructor(outputPath, { level = 6 } = {}) {
    this.outputPath = outputPath;
    this.entries = [];
    this.stream = fs.createWriteStream(outputPath);
    this.archive = archiver("zip", { zlib: { level } });
    this.archive.on("error", (err) => this.stream.destroy(err));
    this.archive.pipe(this.stream);
  }

  async addBuffer(name, buffer) {
    this.archive.append(buffer, { name });
    this.entries.push(name);
    return name;
  }

  async addCover(buffer, meta = {}) {
    const ext = formatExtension(meta.format || (await detectFormat(buffer)));
    return this.addBuffer(`cover.${ext}`, buffer);
  }

  async addImage(buffer, meta = {}, name = null) {
    const ext = formatExtension(meta.format || (await detectFormat(buffer)));
    return this.addBuffer(name || `000.${ext}`, buffer);
  }

  async addChapter(folder, info = {}) {
    const files = info.files || [];
    const dimensions = info.dimensions || [];
    let added = 0;
    for (let i = 0; i < files.length; i += 1) {
      const buffer = fs.readFileSync(files[i]);
      const meta = dimensions[i] || {};
      const ext = formatExtension(meta.format || (await detectFormat(buffer)));
      await this.addBuffer(`${folder}/${String(i).padStart(3, "0")}.${ext}`, buffer);
      added += 1;
    }
    return added;
  }

  finish() {
    return new Promise((resolve, reject) => {
      this.stream.once("close", resolve);
      this.stream.once("error", reject);
      this.archive.once("error", reject);
      this.archive.finalize().catch(reject);
    });
  }
}

module.exports = { CbzBuilder, formatExtension, chapterFolder };
