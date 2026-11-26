"use strict";

const crypto = require("crypto");

class DiscoveryStore {
  constructor(ttlMs = 15 * 60 * 1000) {
    this.ttlMs = ttlMs;
    this.entries = new Map();
    this._ticker = setInterval(() => this.sweep(), 60_000);
    this._ticker.unref?.();
  }

  create(data) {
    const token = crypto.randomBytes(12).toString("hex");
    this.entries.set(token, { data, expiresAt: Date.now() + this.ttlMs });
    this.sweep();
    return token;
  }

  get(token) {
    if (typeof token !== "string") return null;
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAt <= Date.now()) {
      this.entries.delete(token);
      return null;
    }
    return entry.data;
  }

  sweep() {
    const now = Date.now();
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.entries.delete(token);
    }
  }
}

const discoveryStore = new DiscoveryStore();

module.exports = { DiscoveryStore, discoveryStore };
