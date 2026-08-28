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

/* ───────────────── restrictToEnabledSources ─────────────────
 * Regression cover for the source-filtering rule: a technology reaches the
 * radar only while at least one ENABLED source still vouches for it. Each of
 * these cases maps to a bug that actually shipped, so they are the guard
 * against re-introducing one.
 */

const { restrictToEnabledSources } = __test__;

/** Minimal Technology-shaped fixture — only the fields the filter reads. */
function tech(slug, sources, extra = {}) {
  return {
    slug,
    name: slug,
    mentions: sources.map((source) => ({ source, title: `${slug} on ${source}` })),
    githubStars: 0,
    githubUrl: null,
    githubRepoAgeDays: null,
    ...extra,
  };
}

const FIXTURE = [
  tech("react", ["dev.to", "lobsters"]),
  tech("rust", ["lobsters"]),
  tech("kubernetes", ["github-trending"], {
    githubStars: 13100,
    githubUrl: "https://github.com/kubernetes/kubernetes",
    githubRepoAgeDays: 400,
  }),
];

test("restrictToEnabledSources: empty Set means nothing is eligible", () => {
  // This is the one that shipped broken: an empty set was treated as "no
  // filter", so disabling every source left the radar fully populated.
  assert.deepEqual(restrictToEnabledSources(FIXTURE, new Set()), []);
  assert.deepEqual(restrictToEnabledSources(FIXTURE, []), []);
});

test("restrictToEnabledSources: null/undefined opts out of filtering", () => {
  assert.equal(restrictToEnabledSources(FIXTURE, null).length, 3);
  assert.equal(restrictToEnabledSources(FIXTURE, undefined).length, 3);
  assert.equal(restrictToEnabledSources(FIXTURE).length, 3);
});

test("restrictToEnabledSources: a non-iterable is a contract error, not a silent pass", () => {
  // Guards the shape of the bug above: any falsy-but-not-null value must fail
  // loudly rather than quietly returning the entire store.
  // "" and "dev.to" matter most: strings are iterable, so without an explicit
  // string check a single source id would quietly become a Set of characters.
  for (const bad of [false, 0, "", NaN, "dev.to"]) {
    assert.throws(() => restrictToEnabledSources(FIXTURE, bad), TypeError);
  }
});

test("restrictToEnabledSources: keeps only techs an enabled source vouches for", () => {
  const kept = restrictToEnabledSources(FIXTURE, new Set(["lobsters"]));
  assert.deepEqual(kept.map((t) => t.slug), ["react", "rust"]);
  // react's dev.to mention is dropped too — mention lists are narrowed, and
  // they feed distinct-source and mention-count scoring.
  assert.deepEqual(kept[0].mentions.map((m) => m.source), ["lobsters"]);
});

test("restrictToEnabledSources: an unknown source id matches nothing", () => {
  assert.deepEqual(restrictToEnabledSources(FIXTURE, new Set(["totally-made-up"])), []);
});

test("restrictToEnabledSources: strips GitHub metadata when github-trending is off", () => {
  // Stars survive as scoring input and as visible "13.1k GitHub stars" text,
  // so leaving them behind kept a disabled source on the radar.
  const [k] = restrictToEnabledSources(
    [FIXTURE[2], ...FIXTURE.slice(0, 2)],
    new Set(["github-trending", "dev.to"]),
  );
  assert.equal(k.githubStars, 13100);
  assert.equal(k.githubUrl, "https://github.com/kubernetes/kubernetes");

  const withGitHubOff = restrictToEnabledSources(
    [tech("kubernetes", ["dev.to"], {
      githubStars: 13100,
      githubUrl: "https://github.com/kubernetes/kubernetes",
      githubRepoAgeDays: 400,
    })],
    new Set(["dev.to"]),
  );
  assert.equal(withGitHubOff[0].githubStars, 0);
  assert.equal(withGitHubOff[0].githubUrl, null);
  assert.equal(withGitHubOff[0].githubRepoAgeDays, null);
});

test("restrictToEnabledSources: returns copies — the stored objects are untouched", () => {
  const store = [
    tech("kubernetes", ["dev.to", "github-trending"], {
      githubStars: 13100,
      githubUrl: "https://github.com/kubernetes/kubernetes",
      githubRepoAgeDays: 400,
    }),
  ];
  restrictToEnabledSources(store, new Set(["dev.to"]));
  // The store keeps full history so re-enabling a source restores its blips
  // without refetching.
  assert.equal(store[0].githubStars, 13100);
  assert.equal(store[0].mentions.length, 2);
});

test("restrictToEnabledSources: legacy source ids are migrated before matching", () => {
  const legacy = [tech("react", ["thehackernews.com"])];
  assert.equal(restrictToEnabledSources(legacy, new Set(["thehackernews"])).length, 1);
});
