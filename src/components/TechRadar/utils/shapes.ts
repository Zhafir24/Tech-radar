/**
 * SVG path generators for the blip shapes. All shapes are centered on (0,0)
 * so the caller only has to translate the parent group.
 */

/** Equilateral triangle pointing up, inscribed in a circle of radius r. */
export function trianglePointsUp(r: number): string {
  // Regular triangle: three vertices at 120° intervals starting from top.
  const p1 = pointOnCircle(r, -90);
  const p2 = pointOnCircle(r, 30);
  const p3 = pointOnCircle(r, 150);
  return `${p1} ${p2} ${p3}`;
}

/** Equilateral triangle pointing down, inscribed in a circle of radius r. */
export function trianglePointsDown(r: number): string {
  const p1 = pointOnCircle(r, 90);
  const p2 = pointOnCircle(r, -30);
  const p3 = pointOnCircle(r, -150);
  return `${p1} ${p2} ${p3}`;
}

/**
 * 5-pointed star. `outerR` sets the tip radius; `innerR` (defaults to 40%
 * of the outer) sets the concave notch radius.
 */
export function starPoints(outerR: number, innerR: number = outerR * 0.42): string {
  const points: string[] = [];
  for (let i = 0; i < 10; i++) {
    const radius = i % 2 === 0 ? outerR : innerR;
    // Alternate outer/inner points, starting from the top (12 o'clock).
    const angleDeg = -90 + i * 36;
    points.push(pointOnCircle(radius, angleDeg));
  }
  return points.join(" ");
}

function pointOnCircle(radius: number, angleDeg: number): string {
  const rad = (angleDeg * Math.PI) / 180;
  const x = radius * Math.cos(rad);
  const y = radius * Math.sin(rad);
  return `${x.toFixed(2)},${y.toFixed(2)}`;
}
