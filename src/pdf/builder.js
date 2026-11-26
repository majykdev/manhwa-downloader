"use strict";

const fs = require("fs");
const PDFDocument = require("pdfkit");
const sharp = require("sharp");
const config = require("../config");

const TOC_PAGE_H = 844;
const TOC_MARGIN_X = 24;
const TOC_TOP = 110;
const TOC_COLUMNS = 2;
const TOC_LINE_HEIGHT = 15;
const TOC_COL_GAP = 12;

function containSize(srcW, srcH, boxW, boxH) {
  const width = srcW > 0 ? srcW : boxW;
  const height = srcH > 0 ? srcH : boxH;
  const scale = Math.min(boxW / width, boxH / height);
  return { w: width * scale, h: height * scale };
}

const PRINTER_PAGE_RATIO = 1 / Math.SQRT2;

function printerPageSize(pageSize) {
  const [rawW, rawH] = pageSize || [config.PDF_MAX_PAGE_WIDTH, config.PDF_MAX_PAGE_WIDTH * 2];
  const boxW = Math.max(1, Number(rawW) || config.PDF_MAX_PAGE_WIDTH);
  const boxH = Math.max(1, Number(rawH) || boxW * 2);
  let width = Math.min(boxW, boxH * PRINTER_PAGE_RATIO);
  let height = width / PRINTER_PAGE_RATIO;
  if (height > boxH) {
    height = boxH;
    width = height * PRINTER_PAGE_RATIO;
  }
  return [Math.max(1, Math.round(width)), Math.max(1, Math.round(height))];
}

function fittedFontSize(doc, text, maxWidth, start, min) {
  let size = start;
  doc.fontSize(size);
  while (size > min && doc.widthOfString(text) > maxWidth) {
    size -= 1;
    doc.fontSize(size);
  }
  return size;
}

class PdfBuilder {
  constructor(outputPath, { maxPageWidth, jpegQuality, chapterPageSizeMode, compress, chapterHyperlinks } = {}) {
    this.maxPageWidth = maxPageWidth || config.PDF_MAX_PAGE_WIDTH;
    this.jpegQuality = jpegQuality || config.PDF_JPEG_QUALITY;
    this.chapterHyperlinks = chapterHyperlinks !== false;
    this.chapterPageSizeMode =
      chapterPageSizeMode || config.PDF_CHAPTER_PAGE_SIZE_MODE;
    this.pageCount = 0;
    this.titlePageCount = 0;
    this.outputPath = outputPath;
    this.stream = fs.createWriteStream(outputPath);
    this.doc = new PDFDocument({
      autoFirstPage: false,
      margin: 0,
      compress: compress !== false,
    });
    this.doc.pipe(this.stream);
  }

  pageSizeFromDimensions(meta) {
    const width = this.maxPageWidth;
    const height = Math.max(
      1,
      Math.round(width * ((meta.height || 1) / (meta.width || 1))),
    );
    return [width, height];
  }

  pageSizeFromMetadata(meta) {
    return this.pageSizeFromDimensions(meta);
  }

  async measurePageSize(buffer) {
    const meta = await sharp(buffer).metadata();
    return this.pageSizeFromDimensions(meta);
  }

  lastPageIndex() {
    return this.doc._root.data.Pages.data.Kids.length - 1;
  }

  async addImage(buffer, chapterPageSize) {
    const meta = await sharp(buffer).metadata();
    const natural = this.pageSizeFromMetadata(meta);
    const [pageW, pageH] =
      this.chapterPageSizeMode === "first" && chapterPageSize
        ? chapterPageSize
        : natural;
    const fit = containSize(meta.width, meta.height, pageW, pageH);
    const embedW = Math.min(meta.width || pageW, pageW * 2);

    const jpeg = await sharp(buffer)
      .resize({ width: embedW })
      .jpeg({ quality: this.jpegQuality })
      .toBuffer();

    this.doc.addPage({ size: [pageW, pageH] });
    this.doc.rect(0, 0, pageW, pageH).fill("#ffffff");
    this.doc.image(jpeg, (pageW - fit.w) / 2, (pageH - fit.h) / 2, {
      width: fit.w,
      height: fit.h,
    });
    this.pageCount += 1;
    return this.lastPageIndex();
  }

  async addPreparedImage(buffer, dimensions = {}, chapterPageSize) {
    const natural = this.pageSizeFromDimensions(dimensions);
    const [pageW, pageH] =
      this.chapterPageSizeMode === "first" && chapterPageSize
        ? chapterPageSize
        : natural;
    const srcW = dimensions.width || pageW;
    const srcH = dimensions.height || pageH;
    const fit = containSize(srcW, srcH, pageW, pageH);

    this.doc.addPage({ size: [pageW, pageH] });
    this.doc.rect(0, 0, pageW, pageH).fill("#ffffff");
    this.doc.image(buffer, (pageW - fit.w) / 2, (pageH - fit.h) / 2, {
      width: fit.w,
      height: fit.h,
    });
    this.pageCount += 1;
    return this.lastPageIndex();
  }

  async addCover(buffer, dimensions = {}, options = {}) {
    const image = sharp(buffer);
    const meta = await image.metadata();
    const width = Number(dimensions.width) || meta.width || this.maxPageWidth;
    const height = Number(dimensions.height) || meta.height || 1;
    const jpeg = await image
      .clone()
      .resize({ width: Math.min(width, this.maxPageWidth * 2) })
      .jpeg({ quality: this.jpegQuality })
      .toBuffer();

    if (options.contained) {
      const [pageW, pageH] = printerPageSize([width, height]);
      const fit = containSize(width, height, Math.round(pageW * 0.8), Math.round(pageH * 0.55));
      this.doc.addPage({ size: [pageW, pageH] });
      this.doc.rect(0, 0, pageW, pageH).fill("#ffffff");
      this.doc.image(jpeg, (pageW - fit.w) / 2, (pageH - fit.h) / 2, {
        width: fit.w,
        height: fit.h,
      });
      this.pageCount += 1;
      const kids = this.doc._root.data.Pages.data.Kids;
      const [page] = kids.splice(this.lastPageIndex(), 1);
      kids.unshift(page);
      return 0;
    }

    const index = await this.addPreparedImage(jpeg, { width, height });
    const kids = this.doc._root.data.Pages.data.Kids;
    const [page] = kids.splice(index, 1);
    kids.unshift(page);
    return 0;
  }

  addSpacer(label, pageSize, detail) {
    const [pageW, pageH] = printerPageSize(pageSize);
    const maxTextW = Math.max(40, pageW - 24);
    const baseFontSize = Math.min(22, Math.max(12, Math.round(pageW / 18)));
    const baseDetailFontSize = Math.min(10, Math.max(8, Math.round(pageW / 32)));
    this.doc.addPage({ size: [pageW, pageH] });
    this.doc.rect(0, 0, pageW, pageH).fill("#ffffff");
    this.doc.font("Helvetica-Bold").fillColor("#111827");
    const fontSize = fittedFontSize(this.doc, String(label), maxTextW, baseFontSize, 10);
    if (detail) {
      this.doc.text(String(label), 12, pageH / 2 - fontSize - 6, {
        align: "center",
        width: maxTextW,
      });
      this.doc.font("Helvetica").fillColor("#4b5563");
      const detailFontSize = fittedFontSize(
        this.doc,
        String(detail),
        maxTextW,
        baseDetailFontSize,
        7,
      );
      this.doc.text(String(detail), 12, pageH / 2 + 8, {
        align: "center",
        width: maxTextW,
      });
    } else {
      this.doc.text(String(label), 12, pageH / 2 - fontSize / 2, {
        align: "center",
        width: maxTextW,
      });
    }
    this.pageCount += 1;
    return this.lastPageIndex();
  }

  addTitlePage(title, entries) {
    const pageW = this.maxPageWidth;
    const rowsPerPage = Math.floor((TOC_PAGE_H - TOC_TOP - 24) / TOC_LINE_HEIGHT);
    const perPage = rowsPerPage * TOC_COLUMNS;
    const pageTotal = Math.max(1, Math.ceil(entries.length / perPage));
    const colW = (pageW - TOC_MARGIN_X * 2 - TOC_COL_GAP) / TOC_COLUMNS;

    for (let p = 0; p < pageTotal; p++) {
      this.doc.addPage({ size: [pageW, TOC_PAGE_H] });
      this.doc.rect(0, 0, pageW, TOC_PAGE_H).fill("#ffffff");

      if (p === 0) {
        this.doc.font("Helvetica-Bold").fontSize(22).fillColor("#111827");
        this.doc.text(title, TOC_MARGIN_X, 32, {
          align: "center",
          width: pageW - TOC_MARGIN_X * 2,
        });
      }

      const start = p * perPage;
      const slice = entries.slice(start, start + perPage);
      slice.forEach((entry, i) => {
        const col = Math.floor(i / rowsPerPage);
        const row = i % rowsPerPage;
        const x = TOC_MARGIN_X + col * (colW + TOC_COL_GAP);
        const y = TOC_TOP + row * TOC_LINE_HEIGHT;
        this.doc.font("Helvetica").fontSize(9.5).fillColor(this.chapterHyperlinks ? "#1d4ed8" : "#374151");
        this.doc.text(entry.label, x, y, {
          ellipsis: true,
          height: TOC_LINE_HEIGHT,
          width: colW,
        });
        if (this.chapterHyperlinks) {
          this.doc.link(x, y, colW, TOC_LINE_HEIGHT, entry.pageIndex);
        }
      });
      this.pageCount += 1;
    }

    const kids = this.doc._root.data.Pages.data.Kids;
    const tocPages = kids.splice(kids.length - pageTotal, pageTotal);
    kids.unshift(...tocPages);
    this.titlePageCount = pageTotal;
  }

  finish() {
    this.doc.end();
    return new Promise((resolve, reject) => {
      this.stream.on("finish", resolve);
      this.stream.on("error", reject);
    });
  }
}

module.exports = { PdfBuilder, printerPageSize };
