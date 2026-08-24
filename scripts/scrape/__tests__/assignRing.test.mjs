import test from "node:test";
import assert from "node:assert/strict";
import { assignRing, movementFor } from "../pipeline/assignRing.mjs";

function tech(stars, mentions) {
  return {
    githubStars: stars,
    mentions: mentions.map((source) => ({ source })),
  };
}

test("assignRing: ADOPT — very-high-star OR 20k+ stars with cross-source coverage", () => {
  assert.equal(assignRing(tech(60_000, ["dev.to"])), "adopt");
  assert.equal(assignRing(tech(25_000, ["dev.to", "github-trending"])), "adopt");
});

test("assignRing: TRIAL — 5k+ stars OR heavy cross-source coverage", () => {
  assert.equal(assignRing(tech(6_000, ["dev.to"])), "trial");
  assert.equal(
    assignRing(
      tech(0, ["dev.to", "github-trending", "infoq", "lobsters", "thehackernews"]),
    ),
    "trial",
  );
});

test("assignRing: ASSESS — moderate signal", () => {
  assert.equal(assignRing(tech(800, ["dev.to"])), "assess");
  assert.equal(assignRing(tech(0, ["dev.to", "infoq", "lobsters"])), "assess");
});

test("assignRing: EMERGING — weak signal by default", () => {
  assert.equal(assignRing(tech(50, ["dev.to"])), "emerging");
  assert.equal(assignRing(tech(0, [])), "emerging");
});

test("movementFor: first-ever run marks everything no-change", () => {
  assert.equal(movementFor("adopt", undefined, undefined, false), "no-change");
});

test("movementFor: new when tech is fresh AND pipeline has history", () => {
  const fresh = new Date().toISOString();
  assert.equal(movementFor("emerging", undefined, fresh, true), "new");
});

test("movementFor: old first-seen with no previous ring = no-change (not fake-new)", () => {
  const old = new Date(Date.now() - 40 * 24 * 3600 * 1000).toISOString();
  assert.equal(movementFor("emerging", undefined, old, true), "no-change");
});

test("movementFor: ring change → moved-up / moved-down", () => {
  assert.equal(movementFor("adopt", "trial", "2024-01-01", true), "moved-up");
  assert.equal(movementFor("emerging", "adopt", "2024-01-01", true), "moved-down");
  assert.equal(movementFor("assess", "assess", "2024-01-01", true), "no-change");
});
