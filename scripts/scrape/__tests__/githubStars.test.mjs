import test from "node:test";
import assert from "node:assert/strict";
import { __test__ } from "../pipeline/githubStars.mjs";
import { SLUG_TO_ENTRY, TAXONOMY } from "../taxonomy.mjs";

const { applyCached } = __test__;

/*
 * These pin the anti-misattribution rule: a technology's star count may only
 * come from its own repository. Before this, aggregate.mjs took the highest
 * star count of any trending repo whose text matched an alias, so the
 * TypeScript blip reported freeCodeCamp's 453k and Kubernetes reported
 * kubescape's 11.6k instead of its own ~125k.
 */

function tech(slug, extra = {}) {
  return {
    slug,
    name: slug,
    mentions: [],
    githubStars: 0,
    githubUrl: null,
    githubRepoAgeDays: null,
    ...extra,
  };
}

test("applyCached: a technology with no canonical repo loses borrowed stars", () => {
  // "javascript" is a language spec with no single repository. It must report
  // no stars rather than javascript-algorithms' 196k.
  assert.equal(SLUG_TO_ENTRY.get("javascript")?.repo, undefined);
  const borrowed = tech("javascript", {
    githubStars: 196519,
    githubUrl: "https://github.com/trekhleb/javascript-algorithms",
    githubRepoAgeDays: 3000,
  });
  const out = applyCached(borrowed, {});
  assert.equal(out.githubStars, 0);
  assert.equal(out.githubUrl, null);
  assert.equal(out.githubRepoAgeDays, null);
});

test("applyCached: a canonical repo with no cache entry yields no stars, never a guess", () => {
  const out = applyCached(
    tech("kubernetes", { githubStars: 11594, githubUrl: "https://github.com/kubescape/kubescape" }),
    {}, // cache miss — the API has never answered for this repo
  );
  assert.equal(out.githubStars, 0);
  assert.equal(out.githubUrl, null);
});

test("applyCached: cached data from the canonical repo replaces the borrowed number", () => {
  const cache = {
    "kubernetes/kubernetes": {
      repo: "kubernetes/kubernetes",
      stars: 125904,
      url: "https://github.com/kubernetes/kubernetes",
      repoAgeDays: 4000,
      fetchedAt: new Date().toISOString(),
    },
  };
  const out = applyCached(
    tech("kubernetes", { githubStars: 11594, githubUrl: "https://github.com/kubescape/kubescape" }),
    cache,
  );
  assert.equal(out.githubStars, 125904);
  assert.equal(out.githubUrl, "https://github.com/kubernetes/kubernetes");
  assert.equal(out.repoAgeDays, undefined); // field is githubRepoAgeDays
  assert.equal(out.githubRepoAgeDays, 4000);
});

test("applyCached: does not mutate the input technology", () => {
  const input = tech("kubernetes", { githubStars: 11594 });
  applyCached(input, {
    "kubernetes/kubernetes": { stars: 125904, url: "u", fetchedAt: new Date().toISOString() },
  });
  assert.equal(input.githubStars, 11594);
});

test("applyCached: a starless tech with no repo is returned untouched", () => {
  // Avoids churning the store with pointless copies on every run.
  const input = tech("sbom");
  assert.equal(applyCached(input, {}), input);
});

test("taxonomy: every declared repo is a plausible owner/name pair", () => {
  // Guards against a typo'd mapping silently producing 404s forever. The real
  // existence check is the API call in enrichGitHubStars, which logs a warning
  // and leaves the technology starless rather than inventing a number.
  const withRepo = TAXONOMY.filter((t) => t.repo);
  assert.ok(withRepo.length >= 40, `expected the canonical mapping to be populated, got ${withRepo.length}`);
  for (const entry of withRepo) {
    assert.match(
      entry.repo,
      /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/,
      `${entry.slug} has a malformed repo: ${entry.repo}`,
    );
  }
});

test("taxonomy: repo values are unique — two technologies cannot claim one repo", () => {
  const seen = new Map();
  for (const entry of TAXONOMY) {
    if (!entry.repo) continue;
    const key = entry.repo.toLowerCase();
    assert.equal(
      seen.has(key),
      false,
      `${entry.slug} and ${seen.get(key)} both claim ${entry.repo}`,
    );
    seen.set(key, entry.slug);
  }
});

test("taxonomy: products with no repository correctly declare none", () => {
  // These are services and concepts, not codebases. Declaring a repo for them
  // is how the borrowed-stars bug started.
  for (const slug of ["aws", "azure", "gcp", "claude", "sbom"]) {
    const entry = SLUG_TO_ENTRY.get(slug);
    if (!entry) continue;
    assert.equal(entry.repo, undefined, `${slug} should not declare a canonical repo`);
  }
});
