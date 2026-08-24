import type {
  BlipDefinition,
  QuadrantDefinition,
  RadarConfig,
  RingDefinition,
  RingId,
} from "../types";
import { hashString, mulberry32 } from "./random";
import { cartesianToPolar, polarToCartesian } from "./polar";

/**
 * Compute the radial band (min/max fraction of outerRadius) available for
 * blip placement in each ring, honoring `scatter.radiusMargin` so blips stay
 * away from the ring stroke.
 */
function ringBand(
  ring: RingDefinition,
  previousRadius: number,
  config: RadarConfig,
): { min: number; max: number } {
  const R = config.outerRadius;
  const marginR = config.scatter.radiusMargin * R;
  const innerR = previousRadius === 0 ? 0 : previousRadius + marginR;
  const outerR = ring.radius - marginR;
  return { min: innerR / R, max: outerR / R };
}

/**
 * Ordered list of `(previousRingRadius, ring)` pairs so ring bands can be
 * computed relative to the ring immediately inside them.
 */
function ringsWithInnerRadius(config: RadarConfig): Array<{
  ring: RingDefinition;
  innerRadius: number;
}> {
  const sorted = [...config.rings].sort((a, b) => a.radius - b.radius);
  return sorted.map((ring, index) => ({
    ring,
    innerRadius: index === 0 ? 0 : sorted[index - 1].radius,
  }));
}

/**
 * Place blips in each (quadrant × ring) segment using stratified angular
 * distribution + area-uniform radial distribution + a few rounds of
 * Lloyd-style relaxation to enforce minimum spacing.
 *
 * Deterministic: seeded per blip id, so a blip's position is stable across
 * renders. Blips with manual `angle` / `radiusFraction` overrides are used
 * verbatim.
 */
export function assignBlipPositions(config: RadarConfig): BlipDefinition[] {
  const { blips, quadrants, center } = config;
  const options = config.scatter;
  const ringBandById = new Map<string, { min: number; max: number }>();
  const ringById = new Map(config.rings.map((r) => [r.id, r]));
  const quadrantById = new Map<string, QuadrantDefinition>(
    quadrants.map((q) => [q.id, q]),
  );

  for (const entry of ringsWithInnerRadius(config)) {
    ringBandById.set(entry.ring.id, ringBand(entry.ring, entry.innerRadius, config));
  }

  const groups = new Map<string, BlipDefinition[]>();
  for (const blip of blips) {
    const key = `${blip.quadrant}|${blip.ring}`;
    const arr = groups.get(key);
    if (arr) arr.push(blip);
    else groups.set(key, [blip]);
  }

  const output: BlipDefinition[] = [];
  const placed: Array<{ x: number; y: number; id: string }> = [];

  for (const [key, groupBlips] of groups) {
    const [qId, rId] = key.split("|") as [string, RingId];
    const quadrant = quadrantById.get(qId);
    const ring = ringById.get(rId);
    const band = ringBandById.get(rId);
    if (!quadrant || !ring || !band) continue;

    // Deterministic order by blip number for stratification.
    const sorted = [...groupBlips].sort((a, b) => a.number - b.number);
    const n = sorted.length;

    const angleMin = quadrant.angleRange.min + options.angleMargin;
    const angleMax = quadrant.angleRange.max - options.angleMargin;

    for (let i = 0; i < n; i++) {
      const blip = sorted[i];
      if (blip.angle !== undefined && blip.radiusFraction !== undefined) {
        const { x, y } = polarToCartesian(
          center.x,
          center.y,
          blip.radiusFraction * config.outerRadius,
          blip.angle,
        );
        placed.push({ x, y, id: blip.id });
        output.push(blip);
        continue;
      }

      const rng = mulberry32(hashString(blip.id));

      // Stratified angle: each blip gets a slot [i/n, (i+1)/n] of the arc,
      // then jitters within ~60% of that slot to avoid a rigid rank order.
      const slot = (i + 0.5) / n;
      const jitter = (rng() - 0.5) * (0.6 / n);
      const angleT = Math.min(0.98, Math.max(0.02, slot + jitter));
      let angle = angleMin + (angleMax - angleMin) * angleT;

      // Area-uniform radius: sqrt(rand) prevents clustering near the inner
      // boundary of the band.
      const rMin = band.min;
      const rMax = band.max;
      let radiusFraction = Math.sqrt(
        rMin * rMin + rng() * (rMax * rMax - rMin * rMin),
      );

      const point = polarToCartesian(
        center.x,
        center.y,
        radiusFraction * config.outerRadius,
        angle,
      );
      let { x, y } = point;

      // Lloyd-style relaxation: nudge away from already-placed blips within
      // the same segment, then re-project into the segment.
      for (let iter = 0; iter < options.relaxationIterations; iter++) {
        let pushX = 0;
        let pushY = 0;
        let collisions = 0;
        for (const other of placed) {
          const dx = x - other.x;
          const dy = y - other.y;
          const dist = Math.sqrt(dx * dx + dy * dy) || 1;
          if (dist < options.minSpacing) {
            const push = (options.minSpacing - dist) / dist;
            pushX += dx * push;
            pushY += dy * push;
            collisions++;
          }
        }
        if (collisions === 0) break;
        x += pushX * 0.5;
        y += pushY * 0.5;

        // Re-project so we don't drift out of the segment.
        const projected = projectIntoSegment(
          center,
          x,
          y,
          angleMin,
          angleMax,
          rMin * config.outerRadius,
          rMax * config.outerRadius,
        );
        x = projected.x;
        y = projected.y;
      }

      const finalPolar = cartesianToPolar(center.x, center.y, x, y);
      angle = finalPolar.angle;
      radiusFraction = finalPolar.radius / config.outerRadius;

      placed.push({ x, y, id: blip.id });
      output.push({ ...blip, angle, radiusFraction });
    }
  }

  return output;
}

/**
 * Clamp a point back inside a polar segment defined by an angular window and
 * a radial band. Used after each relaxation nudge.
 */
function projectIntoSegment(
  center: { x: number; y: number },
  x: number,
  y: number,
  angleMin: number,
  angleMax: number,
  rMin: number,
  rMax: number,
): { x: number; y: number } {
  const polar = cartesianToPolar(center.x, center.y, x, y);
  const clampedAngle = Math.min(angleMax, Math.max(angleMin, polar.angle));
  const clampedRadius = Math.min(rMax, Math.max(rMin, polar.radius));
  return polarToCartesian(center.x, center.y, clampedRadius, clampedAngle);
}
