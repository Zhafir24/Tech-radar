import test from "node:test";
import assert from "node:assert/strict";
import { extractMentions } from "../pipeline/extract.mjs";

test("extractMentions: matches taxonomy aliases in title + summary + tags", () => {
  const mentions = extractMentions([
    {
      source: "dev.to",
      title: "Deploying Kubernetes on AWS EKS",
      summary: "A hands-on guide",
      tags: ["k8s", "aws"],
      url: "https://example.com/a",
      publishedAt: "2024-01-01T00:00:00Z",
      raw: {},
    },
  ]);
  const slugs = mentions.map((m) => m.slug).sort();
  // Should hit: kubernetes (via title + tag alias), aws-eks (via title), aws (via tag)
  assert.ok(slugs.includes("kubernetes"));
  assert.ok(slugs.includes("aws-eks"));
  assert.ok(slugs.includes("aws"));
});

test("extractMentions: yields no duplicates for the same slug per candidate", () => {
  const mentions = extractMentions([
    {
      source: "dev.to",
      title: "Kubernetes tutorial: kubernetes with k8s and kube",
      summary: "kubernetes kubernetes kubernetes",
      tags: ["kubernetes"],
      url: "https://example.com/a",
      publishedAt: null,
      raw: {},
    },
  ]);
  const k8s = mentions.filter((m) => m.slug === "kubernetes");
  assert.equal(k8s.length, 1);
});

test("extractMentions: drops candidates with no taxonomy match", () => {
  const mentions = extractMentions([
    {
      source: "dev.to",
      title: "SomeCompletelyUnknownFramework tutorial",
      summary: "About a made-up thing",
      tags: ["esoteric"],
      url: "https://example.com/x",
      publishedAt: null,
      raw: {},
    },
  ]);
  assert.equal(mentions.length, 0);
});

test("extractMentions: defensive against missing/malformed candidates", () => {
  const mentions = extractMentions([
    null,
    undefined,
    { source: "dev.to" }, // no title, summary, tags
    {
      source: "dev.to",
      title: "React talk",
      // tags missing entirely
      url: "https://example.com/x",
      publishedAt: null,
      raw: {},
    },
  ]);
  const slugs = mentions.map((m) => m.slug);
  assert.deepEqual(slugs, ["react"]);
});

test("extractMentions: github-trending picks the taxonomy entry matching the repo name", () => {
  const mentions = extractMentions([
    {
      source: "github-trending",
      title: "kubernetes/kubernetes",
      summary: "Production-Grade Container Scheduling and Management",
      tags: ["kubernetes", "go"],
      url: "https://github.com/kubernetes/kubernetes",
      publishedAt: "2024-01-01T00:00:00Z",
      raw: {
        owner: "kubernetes",
        repo: "kubernetes",
        stars: 100000,
      },
    },
  ]);
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].slug, "kubernetes"); // not "go" or "docker"
});
