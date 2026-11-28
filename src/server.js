"use strict";

const path = require("path");
const express = require("express");
const config = require("./config");
const { JobStore } = require("./jobs/store");
const { createApiRouter } = require("./routes/api");
const { debugLog } = require("./debug");

const app = express();
const store = new JobStore();

app.disable("x-powered-by");
app.use(express.json({ limit: config.API_JSON_LIMIT }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", createApiRouter(store));

app.use(express.static(path.join(__dirname, "..", "public")));

app.use((err, _req, res, _next) => {
  debugLog("error", err.stack || err.message || String(err));
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

process.on("unhandledRejection", (err) => {
  debugLog("error", `Unhandled rejection: ${err && (err.stack || err.message) || err}`);
});

app.listen(config.PORT, () => {
  console.log(`manhwa-downloader listening on :${config.PORT}`);
});
