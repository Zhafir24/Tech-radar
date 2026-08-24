import test from "node:test";
import assert from "node:assert/strict";
import { selectTop } from "../pipeline/select.mjs";

function makeTech(slug, quadrant, score) {
  return { slug, quadrant, overallScore: score, mentions: [] };
}

test("selectTop: honors per-quadrant minimum floor", () => {
  const many = [];
  for (let i = 0; i < 60; i++) many.push(makeTech(`inf-${i}`, "infrastructure", 100 - i));
  for (let i = 0; i < 60; i++) many.push(makeTech(`ai-${i}`, "ai-automation", 100 - i));
  for (let i = 0; i < 20; i++) many.push(makeTech(`sec-${i}`, "security", 100 - i));
  for (let i = 0; i < 30; i++) many.push(makeTech(`dat-${i}`, "data-integration", 100 - i));

  const chosen = selectTop(many);
  const perQ = chosen.reduce((acc, t) => {
    acc[t.quadrant] = (acc[t.quadrant] ?? 0) + 1;
    return acc;
  }, {});
  // Each quadrant must contribute at least MIN_PER_QUADRANT (15).
  assert.ok(perQ.infrastructure >= 15, `infrastructure got ${perQ.infrastructure}`);
  assert.ok(perQ["ai-automation"] >= 15, `ai got ${perQ["ai-automation"]}`);
  assert.ok(perQ.security >= 15, `security got ${perQ.security}`);
  assert.ok(perQ["data-integration"] >= 15, `data got ${perQ["data-integration"]}`);
  assert.equal(chosen.length, 100);
});

test("selectTop: returns everything when under the target total", () => {
  const few = [
    makeTech("a", "infrastructure", 90),
    makeTech("b", "ai-automation", 80),
    makeTech("c", "security", 70),
  ];
  const chosen = selectTop(few);
  assert.equal(chosen.length, 3);
});

test("selectTop: never duplicates slugs", () => {
  const items = [
    makeTech("k", "infrastructure", 90),
    makeTech("k", "infrastructure", 80), // dup slug — should collapse
    makeTech("r", "ai-automation", 70),
  ];
  const chosen = selectTop(items);
  const slugs = chosen.map((t) => t.slug);
  assert.equal(new Set(slugs).size, slugs.length);
});

test("selectTop: highest-scoring wins ties for slot allocation", () => {
  const items = [
    makeTech("a", "infrastructure", 90),
    makeTech("b", "infrastructure", 30),
    makeTech("c", "infrastructure", 50),
  ];
  const chosen = selectTop(items);
  assert.equal(chosen[0].slug, "a");
});
