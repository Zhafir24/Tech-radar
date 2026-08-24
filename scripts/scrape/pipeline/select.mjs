/**
 * Selection — pick the best up-to-100 blips, balanced across quadrants.
 *
 * Balancing rule: each quadrant gets AT LEAST `MIN_PER_QUADRANT` slots when
 * enough candidates exist, then the remaining slots go to the highest-
 * scoring candidates regardless of quadrant. This prevents a "50 AI blips,
 * 5 security blips" runaway while still respecting quality.
 *
 * If fewer than TARGET_TOTAL qualified technologies exist across all
 * quadrants, we honestly return what we have — never fabricating filler.
 */

const TARGET_TOTAL = 100;
const QUADRANTS = ["infrastructure", "ai-automation", "security", "data-integration"];
const MIN_PER_QUADRANT = 15;

/**
 * @param {import("./aggregate.mjs").Technology[]} scored
 * @returns {import("./aggregate.mjs").Technology[]}
 */
export function selectTop(scored) {
  const byQuadrant = new Map(QUADRANTS.map((q) => [q, []]));
  for (const tech of scored) {
    byQuadrant.get(tech.quadrant)?.push(tech);
  }
  for (const list of byQuadrant.values()) {
    list.sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));
  }

  const selected = new Map();

  // Pass 1: minimum floor per quadrant.
  for (const quadrant of QUADRANTS) {
    const list = byQuadrant.get(quadrant) ?? [];
    for (const tech of list.slice(0, MIN_PER_QUADRANT)) {
      selected.set(tech.slug, tech);
    }
  }

  // Pass 2: fill remaining slots with best-scoring candidates overall.
  const remaining = scored
    .filter((t) => !selected.has(t.slug))
    .sort((a, b) => (b.overallScore ?? 0) - (a.overallScore ?? 0));

  for (const tech of remaining) {
    if (selected.size >= TARGET_TOTAL) break;
    selected.set(tech.slug, tech);
  }

  return [...selected.values()];
}
