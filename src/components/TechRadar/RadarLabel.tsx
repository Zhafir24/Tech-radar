import { memo } from "react";
import type { RingDefinition } from "./types";

interface RadarLabelProps {
  ring: RingDefinition;
  cx: number;
  cy: number;
}

/**
 * Ring name displayed as a large faded watermark centered on the vertical
 * axis inside its ring band (Zalando-style). No halo — the label sits
 * behind the blips at low opacity so it doesn't compete with them.
 */
export const RadarLabel = memo(function RadarLabel({
  ring,
  cx,
  cy,
}: RadarLabelProps) {
  return (
    <text
      x={cx}
      y={cy - ring.labelRadius}
      textAnchor="middle"
      dominantBaseline="central"
      fill={ring.colors.label}
      fontSize={38}
      fontWeight={700}
      letterSpacing="0.04em"
      opacity={0.32}
      className="select-none pointer-events-none"
    >
      {ring.label}
    </text>
  );
});
