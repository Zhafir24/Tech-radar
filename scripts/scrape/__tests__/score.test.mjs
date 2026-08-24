import test from "node:test";
import assert from "node:assert/strict";
import { score } from "../pipeline/score.mjs";

function make(overrides = {}) {
  return {
    slug: "x",
    name: "X",
    quadrant: "infrastructure",
    mentions: [],
    firstSeen: new Date().toISOString(),
    lastSeen: new Date().toISOString(),
    githubStars: 0,
    githubUrl: null,
    githubRepoAgeDays: null,
    ...overrides,
  };
}

test("score: returns sub-scores + overall in 0..100", () => {
  const result = score(
    make({
      githubStars: 25_000,
      mentions: [
        { source: "dev.to", publishedAt: new Date().toISOString(), raw: { positive_reactions: 42 } },
        { source: "github-trending", publishedAt: new Date().toISOString(), raw: { stars_in_window: 500 } },
      ],
    }),
  );
  for (const [key, value] of Object.entries(result.scores)) {
    assert.ok(value >= 0 && value <= 100, `${key} out of range: ${value}`);
  }
  assert.ok(result.overallScore >= 0 && result.overallScore <= 100);
});

test("score: higher stars → higher technicalImportance", () => {
  const low = score(make({ githubStars: 100, mentions: [{ source: "dev.to", publishedAt: new Date().toISOString(), raw: {} }] }));
  const high = score(make({ githubStars: 100_000, mentions: [{ source: "dev.to", publishedAt: new Date().toISOString(), raw: {} }] }));
  assert.ok(high.scores.technicalImportance > low.scores.technicalImportance);
});

test("score: multi-source mentions boost engineering", () => {
  const single = score(
    make({ mentions: [{ source: "dev.to", publishedAt: new Date().toISOString(), raw: {} }] }),
  );
  const multi = score(
    make({
      mentions: [
        { source: "dev.to", publishedAt: new Date().toISOString(), raw: {} },
        { source: "github-trending", publishedAt: new Date().toISOString(), raw: {} },
        { source: "infoq", publishedAt: new Date().toISOString(), raw: {} },
      ],
    }),
  );
  assert.ok(multi.scores.engineering > single.scores.engineering);
});

test("score: stale techs (60+ days) get freshness ~0", () => {
  const oldIso = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
  const result = score(
    make({ mentions: [{ source: "dev.to", publishedAt: oldIso, raw: {} }] }),
  );
  assert.equal(result.scores.freshness, 0);
});

test("score: empty mentions doesn't crash", () => {
  const result = score(make({ mentions: [] }));
  assert.ok(Number.isFinite(result.overallScore));
});
