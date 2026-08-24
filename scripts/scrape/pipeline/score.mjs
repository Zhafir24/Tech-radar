/**
 * Scoring engine.
 *
 * Each accumulated technology receives sub-scores and a weighted overall
 * score. All sub-scores are 0..100 for consistency; overall is 0..100.
 *
 *   freshness         weight 0.20 — how recent the most recent mention is
 *   technicalImportance 0.15 — has a GitHub trending signal (stars/velocity)
 *   community         0.20 — cumulative engagement (reactions, stars gained)
 *   engineering       0.15 — spread across sources (cross-verification)
 *   productionReadiness 0.10 — GitHub star tier (heuristic maturity)
 *   innovation        0.05 — bonus for very-new-but-mentioned techs
 *   confidence        0.15 — number and quality of mentions
 *
 * Sub-scores are attached to each technology so the selector can explain
 * why an item was kept or dropped.
 */

const WEIGHTS = {
  freshness: 0.2,
  technicalImportance: 0.15,
  community: 0.2,
  engineering: 0.15,
  productionReadiness: 0.1,
  innovation: 0.05,
  confidence: 0.15,
};

/** @param {import("./aggregate.mjs").Technology} tech @returns {import("./aggregate.mjs").Technology} */
export function score(tech) {
  const now = Date.now();
  const mostRecent = mostRecentMentionMs(tech, now);
  const ageDays = Math.max(0, (now - mostRecent) / (1000 * 60 * 60 * 24));

  // Freshness: 100 for today, decays to 0 over 60 days.
  const freshness = clamp(100 - (ageDays / 60) * 100);

  // Technical importance: does GitHub trending have this tech? Use star tier.
  const stars = tech.githubStars ?? 0;
  const technicalImportance = stars > 0
    ? clamp(Math.log10(stars + 1) * 20)  // 100 stars → 40, 10k → 80, 100k → 100
    : 30;

  // Community interest: sum of dev.to reactions + github window stars.
  const reactionsSum = tech.mentions.reduce(
    (sum, mention) => sum + (mention.raw?.positive_reactions ?? 0),
    0,
  );
  const windowStars = tech.mentions.reduce(
    (sum, mention) => sum + (mention.raw?.stars_in_window ?? 0),
    0,
  );
  const community = clamp(
    Math.log10(reactionsSum + windowStars + 1) * 25,
  );

  // Engineering impact: distinct sources cross-verifying the tech.
  const sourceCount = new Set(tech.mentions.map((m) => m.source)).size;
  const engineering = clamp(sourceCount * 30);

  // Production readiness: GitHub stars proxy for maturity.
  const productionReadiness = stars >= 10_000 ? 90
    : stars >= 1_000 ? 65
    : stars >= 100 ? 40
    : 20;

  // Innovation: bonus for very new + only a few mentions (bleeding edge).
  const innovation = ageDays < 14 && tech.mentions.length <= 3 ? 80 : 30;

  // Confidence: total mentions capped at 100.
  const confidence = clamp(tech.mentions.length * 15);

  const scores = {
    freshness,
    technicalImportance,
    community,
    engineering,
    productionReadiness,
    innovation,
    confidence,
  };

  const overall = Object.entries(WEIGHTS).reduce(
    (sum, [key, weight]) => sum + scores[key] * weight,
    0,
  );

  return { ...tech, scores, overallScore: Math.round(overall) };
}

function mostRecentMentionMs(tech, now) {
  let latest = 0;
  for (const mention of tech.mentions) {
    if (!mention.publishedAt) continue;
    const ms = new Date(mention.publishedAt).getTime();
    if (!Number.isNaN(ms) && ms > latest) latest = ms;
  }
  return latest || now - 30 * 24 * 3600 * 1000;
}

function clamp(value) {
  return Math.max(0, Math.min(100, value));
}
