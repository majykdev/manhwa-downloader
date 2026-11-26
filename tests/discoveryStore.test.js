"use strict";

const { test } = require("node:test");
const assert = require("node:assert");

const { DiscoveryStore } = require("../src/jobs/discoveryStore");

test("DiscoveryStore returns stored data and rejects unknown tokens", () => {
  const store = new DiscoveryStore(60_000);
  const token = store.create({ title: "Test" });
  assert.deepStrictEqual(store.get(token), { title: "Test" });
  assert.strictEqual(store.get("nope"), null);
  store._ticker.unref?.();
  clearInterval(store._ticker);
});

test("DiscoveryStore expires old tokens", () => {
  const store = new DiscoveryStore(-1);
  const token = store.create({ title: "Old" });
  assert.strictEqual(store.get(token), null);
  clearInterval(store._ticker);
});
