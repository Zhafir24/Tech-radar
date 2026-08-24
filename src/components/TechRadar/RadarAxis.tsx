import { memo } from "react";
import type { AxisStyle } from "./types";

interface RadarAxisProps {
  cx: number;
  cy: number;
  /** Half-length of each axis (the outer ring radius). */
  extent: number;
  style: AxisStyle;
}

/**
 * Very subtle crosshair dividing the radar into four quadrants.
 * Zalando-style: solid thin light-gray lines, no center dot.
 */
export const RadarAxis = memo(function RadarAxis({
  cx,
  cy,
  extent,
  style,
}: RadarAxisProps) {
  const common = {
    stroke: style.color,
    strokeWidth: style.strokeWidth,
    ...(style.dashArray ? { strokeDasharray: style.dashArray } : {}),
  } as const;

  return (
    <g aria-hidden="true">
      <line x1={cx} y1={cy - extent} x2={cx} y2={cy + extent} {...common} />
      <line x1={cx - extent} y1={cy} x2={cx + extent} y2={cy} {...common} />
    </g>
  );
});
