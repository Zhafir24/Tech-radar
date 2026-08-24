/**
 * Ring assignment — one of the hardest parts of a real Tech Radar.
 *
 * Rings encode organizational adoption maturity:
 *   ADOPT    — proven, use freely
 *   TRIAL    — production-worthy, evaluate for your context
 *   ASSESS   — worth a small experiment
 *   EMERGING — watch closely, not yet ready
 *
 * A scraper cannot infer what YOUR org should adopt. What it CAN infer is
 * industry maturity, using stable public signals:
 *   - GitHub star tier      → maturity (thousands of orgs already using)
 *   - Cross-source mentions → widely discussed
 *   - Freshness             → still active vs. abandoned
 *
 * The heuristic below is explicitly documented so operators know how items
 * end up where they do. Movement status is also assigned:
 *   NEW        first appearance in the last 14 days
 *   MOVED-UP   ring shifted inward (more mature) vs. previous run
 *   MOVED-DOWN ring shifted outward vs. previous run
 *   NO-CHANGE  same ring as previous run (default)
 */

/** @typedef {"adopt"|"trial"|"assess"|"emerging"} RingId */
/** @typedef {"no-change"|"moved-up"|"moved-down"|"new"} MovementStatus */

const RING_ORDER = ["adopt", "trial", "assess", "emerging"];

/** @param {import("./aggregate.mjs").Technology} tech @returns {RingId} */
export function assignRing(tech) {
  const stars = tech.githubStars ?? 0;
  const sourceCount = new Set(tech.mentions.map((m) => m.source)).size;
  const mentionCount = tech.mentions.length;

  // ADOPT: broadly proven — large repo AND cross-source visibility.
  if (stars >= 20_000 && sourceCount >= 2) return "adopt";
  if (stars >= 50_000) return "adopt";

  // TRIAL: strong signal but narrower — mid-tier stars or heavy coverage.
  if (stars >= 5_000) return "trial";
  if (mentionCount >= 5 && sourceCount >= 2) return "trial";

  // ASSESS: moderate signal — some stars OR consistent coverage.
  if (stars >= 500) return "assess";
  if (mentionCount >= 3) return "assess";

  // EMERGING: everything else that made it through the taxonomy.
  return "emerging";
}

/**
 * Compare with the previous ring stored in tech-store to derive movement.
 *
 *  - `pipelineHasHistory` = true when the previous-rings snapshot from
 *    the last run had at least one entry. On the very first pipeline run
 *    this is false and we must NOT flag every blip as "new" (that would
 *    just represent the pipeline booting, not a real technology change).
 *  - If a tech has no previous ring AND the pipeline has history, this
 *    technology was genuinely added since the last edition → "new".
 *  - Otherwise ring changes map to moved-up / moved-down; unchanged rings
 *    map to no-change.
 */
export function movementFor(currentRing, previousRing, firstSeenIso, pipelineHasHistory) {
  if (!previousRing) {
    if (!pipelineHasHistory) return "no-change";
    const firstSeenMs = firstSeenIso ? Date.parse(firstSeenIso) : Date.now();
    const ageDays = (Date.now() - firstSeenMs) / (1000 * 60 * 60 * 24);
    return ageDays < 14 ? "new" : "no-change";
  }
  if (currentRing === previousRing) return "no-change";
  const currentIndex = RING_ORDER.indexOf(currentRing);
  const previousIndex = RING_ORDER.indexOf(previousRing);
  if (currentIndex < previousIndex) return "moved-up";
  if (currentIndex > previousIndex) return "moved-down";
  return "no-change";
}
