import { memo } from "react";
import type { RingDefinition } from "./types";

interface RadarRingProps {
  ring: RingDefinition;
  cx: number;
  cy: number;
}

/** A single concentric maturity ring — colored per its ring definition. */
export const RadarRing = memo(function RadarRing({
  ring,
  cx,
  cy,
}: RadarRingProps) {
  return (
    <circle
      cx={cx}
      cy={cy}
      r={ring.radius}
      fill="none"
      stroke={ring.colors.ring}
      strokeWidth={1.5}
    />
  );
});
