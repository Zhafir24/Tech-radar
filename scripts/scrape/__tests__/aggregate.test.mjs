import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { __test__ } from "../pipeline/aggregate.mjs";

const { validateStored, assignStableNumbers } = __test__;

test("validateStored: drops entries with unknown slug", () => {
  assert.equal(validateStored({ slug: "not-a-real-tech", mentions: [] }), null);
});

test("validateStored: drops entries with missing slug", () => {
  assert.equal(validateStored({ mentions: [] }), null);
  assert.equal(validateStored({ slug: 42 }), null);
  assert.equal(validateStored(null), null);
});

test("validateStored: refreshes name and quadrant from taxonomy", () => {
  const result = validateStored({
    slug: "kubernetes",
    name: "STALE NAME",
    quadrant: "wrong-quadrant",
    mentions: [],
  });
  assert.equal(result.name, "Kubernetes");
  assert.equal(result.quadrant, "infrastructure");
});

test("validateStored: filters malformed mentions", () => {
  const result = validateStored({
    slug: "kubernetes",
    mentions: [
      { slug: "kubernetes", source: "dev.to", url: "https://x.com/a" }, // OK
      { slug: "kubernetes", source: "dev.to" }, // missing url — drop
      "not an object", // drop
      null, // drop
    ],
  });
  assert.equal(result.mentions.length, 1);
});

test("validateStored: migrates legacy source ids on stored mentions", () => {
  const result = validateStored({
    slug: "kubernetes",
    mentions: [
      { slug: "kubernetes", source: "thehackernews.com", url: "https://a" },
      { slug: "kubernetes", source: "infoq.com", url: "https://b" },
      { slug: "kubernetes", source: "dev.to", url: "https://c" },
    ],
  });
  const sources = result.mentions.map((m) => m.source);
  assert.deepEqual(sources, ["thehackernews", "infoq", "dev.to"]);
});

test("validateStored: coerces githubStars safely", () => {
  assert.equal(
    validateStored({ slug: "kubernetes", githubStars: "not a number", mentions: [] }).githubStars,
    0,
  );
  assert.equal(
    validateStored({ slug: "kubernetes", githubStars: -5, mentions: [] }).githubStars,
    0,
  );
  assert.equal(
    validateStored({ slug: "kubernetes", githubStars: 12345, mentions: [] }).githubStars,
    12345,
  );
});

test("assignStableNumbers: preserves existing valid numbers, fills gaps for new ones", () => {
  const now = new Date().toISOString();
  const map = new Map([
    ["a", { slug: "a", number: 5, firstSeen: "2024-01-01" }],
    ["b", { slug: "b", number: 0, firstSeen: "2024-01-02" }],
    ["c", { slug: "c", number: 3, firstSeen: "2024-01-03" }],
    ["d", { slug: "d", number: 0, firstSeen: "2024-01-04" }],
  ]);
  assignStableNumbers(map);
  const byName = Object.fromEntries([...map.entries()].map(([k, v]) => [k, v.number]));
  assert.equal(byName.a, 5); // preserved
  assert.equal(byName.c, 3); // preserved
  // b and d get 1 and 2 (next unused, chronological by firstSeen).
  assert.equal(byName.b, 1);
  assert.equal(byName.d, 2);
});

test("assignStableNumbers: collisions resolved (first wins, later reassigned)", () => {
  const map = new Map([
    ["a", { slug: "a", number: 5, firstSeen: "2024-01-01" }],
    ["b", { slug: "b", number: 5, firstSeen: "2024-01-02" }], // collides with a
  ]);
  assignStableNumbers(map);
  assert.equal(map.get("a").number, 5);
  assert.notEqual(map.get("b").number, 5);
  assert.ok(map.get("b").number > 0);
});
