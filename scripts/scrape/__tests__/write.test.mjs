import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { writeSnapshot, __test__ } from "../pipeline/write.mjs";

const { sourceIdLabel, mentionSourceLabel, sourceLabel, buildDescription } = __test__;

function mention(source, url, publishedAt = "2026-08-30T10:00:00.000Z") {
  return { slug: "kubernetes", source, url, title: "t", publishedAt, raw: {} };
}

/* ───────────────── id-only labels (sourceIdLabel) ─────────────────
 * Feeds the distinct-source list in the `owner` field. It must map one id to
 * exactly one label — see the aggregator case further down for why there is no
 * hostname step here.
 */

test("sourceIdLabel: built-in ids keep their existing labels", () => {
  assert.equal(sourceIdLabel("dev.to"), "dev.to");
  assert.equal(sourceIdLabel("github-trending"), "GitHub Trending");
  assert.equal(sourceIdLabel("thehackernews"), "The Hacker News");
  assert.equal(sourceIdLabel("infoq"), "InfoQ");
  assert.equal(sourceIdLabel("lobsters"), "Lobste.rs");
});

test("sourceIdLabel: legacy source spellings still map to the same labels", () => {
  assert.equal(sourceIdLabel("thehackernews.com"), "The Hacker News");
  assert.equal(sourceIdLabel("infoq.com"), "InfoQ");
});

test("sourceIdLabel: a built-in id wins over a name map entry", () => {
  // The map only ever carries custom sources; a collision must not be able to
  // rename a built-in out from under the frontend.
  assert.equal(sourceIdLabel("dev.to", { "dev.to": "Hijacked" }), "dev.to");
});

test("sourceIdLabel: a known custom id resolves to its configured name", () => {
  assert.equal(
    sourceIdLabel("custom-e68e90ed91", { "custom-e68e90ed91": "Tech Radar" }),
    "Tech Radar",
  );
});

test("sourceIdLabel: an orphaned custom id falls back to the raw id", () => {
  // No hostname rescue here — one id, one label, whatever it costs in prettiness.
  assert.equal(sourceIdLabel("custom-f5d8bc6d55", {}), "custom-f5d8bc6d55");
  assert.equal(sourceIdLabel("custom-f5d8bc6d55"), "custom-f5d8bc6d55");
});

test("sourceIdLabel: a blank or non-string configured name is ignored", () => {
  assert.equal(sourceIdLabel("custom-deadbeef01", { "custom-deadbeef01": "   " }), "custom-deadbeef01");
  assert.equal(sourceIdLabel("custom-deadbeef01", { "custom-deadbeef01": 7 }), "custom-deadbeef01");
});

test("sourceIdLabel: an inherited Object property is not mistaken for a name", () => {
  // `sourceNames[id]` on a plain object also finds `constructor`, `toString`
  // and friends — rendering "function Object() { [native code] }" as a label.
  assert.equal(sourceIdLabel("constructor", {}), "constructor");
  assert.equal(sourceIdLabel("toString", {}), "toString");
});

test("sourceIdLabel: a missing id renders a word, never an empty string", () => {
  for (const bad of [undefined, null, "", 42]) {
    assert.equal(sourceIdLabel(bad, {}), "unknown source");
  }
});

test("sourceIdLabel: a long configured name is capped at 60 chars", () => {
  const capped = sourceIdLabel("custom-deadbeef01", { "custom-deadbeef01": "N".repeat(200) });
  assert.equal(capped.length, 60);
});

/* ───────────────── per-mention labels (mentionSourceLabel) ─────────────────
 * Feeds "Latest from X on DATE", which is a claim about ONE article, so the
 * article's own hostname is a truthful last resort before the hash id.
 */

test("mentionSourceLabel: built-in and configured names take precedence over the url", () => {
  assert.equal(mentionSourceLabel(mention("dev.to", "https://dev.to/a/b")), "dev.to");
  assert.equal(
    mentionSourceLabel(mention("custom-e68e90ed91", "https://www.techradar.com/news/x"), {
      "custom-e68e90ed91": "Tech Radar",
    }),
    "Tech Radar",
  );
  // The name is used even when no url survived.
  assert.equal(
    mentionSourceLabel(mention("custom-e68e90ed91", undefined), {
      "custom-e68e90ed91": "Tech Radar",
    }),
    "Tech Radar",
  );
});

test("mentionSourceLabel: an orphaned custom id falls back to the url hostname", () => {
  // The removed-source case: the mentions outlive the config entry.
  assert.equal(
    mentionSourceLabel(mention("custom-e68e90ed91", "https://www.techradar.com/news/x"), {}),
    "techradar.com",
  );
  assert.equal(
    mentionSourceLabel(mention("custom-9995c5d491", "https://smashingmagazine.com/2026/a/")),
    "smashingmagazine.com",
  );
  // `www.` is stripped case-insensitively.
  assert.equal(
    mentionSourceLabel(mention("custom-deadbeef01", "https://WWW.Example.COM/a"), {}),
    "example.com",
  );
});

test("mentionSourceLabel: an unknown id with no usable url falls back to the raw id", () => {
  for (const badUrl of [undefined, null, "", "not a url", "://///", 42, {}]) {
    assert.equal(mentionSourceLabel(mention("custom-deadbeef01", badUrl), {}), "custom-deadbeef01");
  }
});

test("mentionSourceLabel: a mention with neither id nor url renders a word", () => {
  assert.equal(mentionSourceLabel(mention(undefined, undefined), {}), "unknown source");
  assert.equal(mentionSourceLabel(undefined, {}), "unknown source");
});

/* ───────────────── buildDescription / sourceLabel ───────────────── */

/** Minimal Technology-shaped fixture — only the fields write.mjs reads. */
function tech(slug, mentions, extra = {}) {
  return {
    slug,
    name: slug,
    quadrant: "platforms",
    number: 1,
    firstSeen: "2026-08-01T00:00:00.000Z",
    githubStars: 0,
    mentions,
    ...extra,
  };
}

/**
 * An aggregator feed that lives on in the store with its config entry deleted:
 * one source id, six unrelated article hosts.
 */
const ORPHANED_AGGREGATOR = [
  mention("custom-f5d8bc6d55", "https://tildes.net/~comp/a"),
  mention("custom-f5d8bc6d55", "https://thezvi.substack.com/p/b"),
  mention("custom-f5d8bc6d55", "https://simonwillison.net/2026/c/"),
  mention("custom-f5d8bc6d55", "https://blog.terrygodier.com/d"),
  mention("custom-f5d8bc6d55", "https://gmsurf.wasmer.app/e"),
  mention("custom-f5d8bc6d55", "https://www.youtube.com/watch?v=f"),
];

test("buildDescription: renders the custom source's name, not its hash id", () => {
  // The shipped bug, verbatim: "Latest from custom-e68e90ed91 on 2026-08-30".
  const m = mention("custom-e68e90ed91", "https://www.techradar.com/news/x");
  const t = tech("kubernetes", [m, m, m, m, m]);
  assert.equal(
    buildDescription(t, m, { "custom-e68e90ed91": "Tech Radar" }),
    "Latest from Tech Radar on 2026-08-30 · 5 recent mentions",
  );
});

test("buildDescription: a removed custom source degrades to its hostname", () => {
  const m = mention("custom-e68e90ed91", "https://www.techradar.com/news/x");
  assert.equal(
    buildDescription(tech("kubernetes", [m]), m, {}),
    "Latest from techradar.com on 2026-08-30 · 1 recent mention",
  );
});

test("buildDescription: an orphaned aggregator names the host of THAT article", () => {
  const t = tech("kubernetes", ORPHANED_AGGREGATOR);
  const mostRecent = ORPHANED_AGGREGATOR[2];
  assert.equal(
    buildDescription(t, mostRecent, {}),
    "Latest from simonwillison.net on 2026-08-30 · 6 recent mentions",
  );
  // Same source id, different article — the sentence tracks the article.
  assert.equal(
    buildDescription(t, ORPHANED_AGGREGATOR[5], {}),
    "Latest from youtube.com on 2026-08-30 · 6 recent mentions",
  );
});

test("buildDescription: built-in wording and star prefix are unchanged", () => {
  const m = mention("dev.to", "https://dev.to/a/b");
  assert.equal(
    buildDescription(tech("kubernetes", [m, m], { githubStars: 13100 }), m),
    "13.1k GitHub stars · Latest from dev.to on 2026-08-30 · 2 recent mentions",
  );
});

test("sourceLabel: one orphaned aggregator id stays ONE entry, not six hosts", () => {
  // The owner field is a distinct-SOURCE list. Expanding an id into per-article
  // hostnames would report a single feed as six sources.
  const label = sourceLabel(tech("kubernetes", ORPHANED_AGGREGATOR), {});
  assert.equal(label, "custom-f5d8bc6d55");
  assert.equal(label.split(", ").length, 1);
});

test("sourceLabel: an orphaned id whose articles share one host is still one entry", () => {
  const sameHost = tech("kubernetes", [
    mention("custom-cee48a6d88", "https://hashnode.com/a"),
    mention("custom-cee48a6d88", "https://hashnode.com/b"),
    mention("custom-cee48a6d88", "https://hashnode.com/c"),
  ]);
  assert.equal(sourceLabel(sameHost, {}).split(", ").length, 1);
});

test("sourceLabel: dedupes resolved labels and stays capped at 60 chars", () => {
  const t = tech("kubernetes", [
    mention("dev.to", "https://dev.to/a"),
    mention("dev.to", "https://dev.to/b"),
    mention("custom-e68e90ed91", "https://www.techradar.com/news/x"),
  ]);
  assert.equal(sourceLabel(t, { "custom-e68e90ed91": "Tech Radar" }), "dev.to, Tech Radar");

  const long = tech("kubernetes", [
    mention("custom-1", "https://a.dev/1"),
    mention("custom-2", "https://b.dev/2"),
  ]);
  const capped = sourceLabel(long, {
    "custom-1": "A".repeat(50),
    "custom-2": "B".repeat(50),
  });
  assert.equal(capped.length, 60);
});

/* ───────────────── writeSnapshot ───────────────── */

/** writeSnapshot writes relative to cwd — never let a test hit the real repo. */
function inTempCwd(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "radar-write-"));
  const previousCwd = process.cwd();
  process.chdir(dir);
  try {
    return fn(dir);
  } finally {
    process.chdir(previousCwd);
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

const BASE_CONFIG = { rings: [], quadrants: [] };

test("writeSnapshot: works with two args (back-compat with existing callers)", () => {
  inTempCwd(() => {
    const m = mention("custom-e68e90ed91", "https://www.techradar.com/news/x");
    const result = writeSnapshot([tech("kubernetes", [m])], BASE_CONFIG);
    assert.equal(result.blipCount, 1);
    const blip = JSON.parse(fs.readFileSync(result.path, "utf8")).config.blips[0];
    // No map supplied → hostname in the sentence, raw id in the source list.
    assert.match(blip.description, /^Latest from techradar\.com on 2026-08-30/);
    assert.equal(blip.owner, "custom-e68e90ed91");
  });
});

test("writeSnapshot: threads the name map into description and owner", () => {
  inTempCwd(() => {
    const m = mention("custom-e68e90ed91", "https://www.techradar.com/news/x");
    const result = writeSnapshot([tech("kubernetes", [m])], BASE_CONFIG, {
      "custom-e68e90ed91": "Tech Radar",
    });
    const blip = JSON.parse(fs.readFileSync(result.path, "utf8")).config.blips[0];
    assert.equal(blip.description, "Latest from Tech Radar on 2026-08-30 · 1 recent mention");
    assert.equal(blip.owner, "Tech Radar");
  });
});
