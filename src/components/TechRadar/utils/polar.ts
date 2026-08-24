/**
 * Polar → Cartesian conversion using the radar convention:
 * 0° points at 12 o'clock and angles increase clockwise.
 *
 *   x = cx + r · sin(θ)
 *   y = cy − r · cos(θ)
 */
export function polarToCartesian(
  cx: number,
  cy: number,
  radius: number,
  angleDeg: number,
): { x: number; y: number } {
  const rad = (angleDeg * Math.PI) / 180;
  return {
    x: cx + radius * Math.sin(rad),
    y: cy - radius * Math.cos(rad),
  };
}

/**
 * Cartesian → polar conversion. Returns angle in degrees (0° = 12 o'clock,
 * clockwise) and radius in viewBox units.
 */
export function cartesianToPolar(
  cx: number,
  cy: number,
  x: number,
  y: number,
): { angle: number; radius: number } {
  const dx = x - cx;
  const dy = y - cy;
  const radius = Math.sqrt(dx * dx + dy * dy);
  // atan2(dx, -dy) puts 0° at 12 o'clock and rotates clockwise.
  let angle = (Math.atan2(dx, -dy) * 180) / Math.PI;
  if (angle < 0) angle += 360;
  return { angle, radius };
}
