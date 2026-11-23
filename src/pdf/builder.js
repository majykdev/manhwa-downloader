"use strict";

const fs = require("fs");
const PDFDocument = require("pdfkit");
const sharp = require("sharp");
const config = require("../config");

const SPACER_W = 612; // ~letter width in points
const SPACER_H = 792;

/**
 * Streaming PDF writer: only one image is held in memory at a time, so even
 * a multi-thousand-page book stays within the process memory budget.
 */
class PdfBuilder {
  constructor(outputPath, { maxPageWidth, jpegQuality } = {}) {
    this.maxPageWidth = maxPageWidth || config.PDF_MAX_PAGE_WIDTH;
    this.jpegQuality = jpegQuality || config.PDF_JPEG_QUALITY;
    this.pageCount = 0;
    this.outputPath = outputPath;
    this.stream = fs.createWriteStream(outputPath);
    this.doc = new PDFDocument({
      autoFirstPage: false,
      margin: 0,
      compress: true,
    });
    this.doc.pipe(this.stream);
  }

  async addImage(buffer) {
    const meta = await sharp(buffer).metadata();
    const w = Math.min(this.maxPageWidth, meta.width || this.maxPageWidth);
    const h = Math.round(w * ((meta.height || 1) / (meta.width || 1)));
    const jpeg = await sharp(buffer)
      .jpeg({ quality: this.jpegQuality })
      .toBuffer();
    this.doc.addPage({ size: [w, h] });
    this.doc.image(jpeg, 0, 0, { width: w, height: h });
    this.pageCount += 1;
  }

  addSpacer(chapterNumber) {
    this.doc.addPage({ size: [SPACER_W, SPACER_H] });
    this.doc.font("Helvetica-Bold").fontSize(42).fillColor("#111827");
    this.doc.text(`Chapter ${chapterNumber}`, 0, SPACER_H / 2 - 21, {
      align: "center",
      width: SPACER_W,
    });
    this.pageCount += 1;
  }

  finish() {
    this.doc.end();
    return new Promise((resolve, reject) => {
      this.stream.on("finish", resolve);
      this.stream.on("error", reject);
    });
  }
}

module.exports = { PdfBuilder, SPACER_W, SPACER_H };
