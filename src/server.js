"use strict";

const path = require("path");
const express = require("express");
const config = require("./config");
const { JobStore } = require("./jobs/store");
const { createApiRouter } = require("./routes/api");

const app = express();
const store = new JobStore();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

app.use("/api", createApiRouter(store));

app.use(express.static(path.join(__dirname, "..", "public")));

app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: "Internal server error." });
});

app.listen(config.PORT, () => {
  console.log(`asura-downloader listening on :${config.PORT}`);
});
