import test from "node:test";
import assert from "node:assert/strict";
import {
  canonicalUrl,
  normalizeTags,
  stripHtml,
  toIsoDate,
} from "../normalize.mjs";

test("canonicalUrl: rejects non-http protocols", () => {
  assert.equal(canonicalUrl("javascript:alert(1)"), "");
  assert.equal(canonicalUrl("file:///etc/passwd"), "");
  assert.equal(canonicalUrl("data:text/html,<h1>hi</h1>"), "");
  assert.equal(canonicalUrl("mailto:a@b.com"), "");
});

test("canonicalUrl: accepts http and https", () => {
  assert.equal(canonicalUrl("https://example.com/path"), "https://example.com/path");
  assert.equal(canonicalUrl("http://example.com/"), "http://example.com/");
});

test("canonicalUrl: strips utm_* + ref query params + hash", () => {
  const input = "https://example.com/x?utm_source=x&utm_medium=y&ref=abc&keep=1#top";
  assert.equal(canonicalUrl(input), "https://example.com/x?keep=1");
});

test("canonicalUrl: safely rejects non-strings and unparseable input", () => {
  assert.equal(canonicalUrl(null), "");
  assert.equal(canonicalUrl(undefined), "");
  assert.equal(canonicalUrl(""), "");
  assert.equal(canonicalUrl("not a url"), "");
  assert.equal(canonicalUrl(42), "");
});

test("normalizeTags: dedupes, lowercases, trims, drops non-strings", () => {
  assert.deepEqual(normalizeTags(["  React  ", "react", "TypeScript", 42, null, "  "]), [
    "react",
    "typescript",
  ]);
  assert.deepEqual(normalizeTags(undefined), []);
  assert.deepEqual(normalizeTags("not-an-array"), []);
});

test("stripHtml: removes tags, scripts, styles, entities, collapses whitespace", () => {
  const input = `
    <p>Hello&nbsp;<b>World</b></p>
    <script>alert(1)</script>
    <style>.x{}</style>
    &amp;&lt;&gt;&quot;&#39;
  `;
  const out = stripHtml(input);
  assert.equal(out, `Hello World &<>"'`);
  assert.equal(stripHtml(null), "");
  assert.equal(stripHtml(""), "");
});

test("toIsoDate: valid inputs become ISO strings, invalid become null", () => {
  assert.ok(toIsoDate("2024-01-01").startsWith("2024-01-01"));
  // Use UTC constructor — local-time Date(2024,0,1) can cross a year
  // boundary in negative UTC offsets, which was flaky.
  assert.ok(toIsoDate(new Date(Date.UTC(2024, 0, 1))).startsWith("2024-01-01"));
  assert.equal(toIsoDate("garbage"), null);
  assert.equal(toIsoDate(null), null);
  assert.equal(toIsoDate(undefined), null);
});
