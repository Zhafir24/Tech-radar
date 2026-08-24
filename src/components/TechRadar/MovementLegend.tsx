import { memo } from "react";
import type { MovementStatus, RadarConfig } from "./types";
import { starPoints, trianglePointsDown, trianglePointsUp } from "./utils/shapes";

interface MovementLegendProps {
  config: RadarConfig;
}

interface Entry {
  status: MovementStatus;
  label: string;
}

/**
 * Bottom-center key. Shape sample uses the page text color (neutral) — on
 * the radar itself the shape is drawn in its ring color, so this legend
 * demonstrates *shape meaning* without implying any specific ring color.
 */
export const MovementLegend = memo(function MovementLegend({
  config,
}: MovementLegendProps) {
  const entries: Entry[] = [
    { status: "moved-up", label: "Moved up" },
    { status: "moved-down", label: "Moved down" },
    { status: "new", label: "New" },
    { status: "no-change", label: "No change" },
  ];
  const shapeColor = config.textColor;

  return (
    <ul
      className="flex flex-wrap items-center justify-center gap-x-8 gap-y-3 text-[13px]"
      style={{ color: config.textColor }}
      aria-label="Blip status legend"
    >
      {entries.map((entry) => (
        <li key={entry.status} className="flex items-center gap-2">
          <svg width={20} height={20} viewBox="-12 -12 24 24" aria-hidden="true">
            <ShapeGlyph status={entry.status} color={shapeColor} />
          </svg>
          <span className="whitespace-nowrap">{entry.label}</span>
        </li>
      ))}
    </ul>
  );
});

function ShapeGlyph({
  status,
  color,
}: {
  status: MovementStatus;
  color: string;
}) {
  const r = 8;
  const common = { fill: color, stroke: "#FFFFFF", strokeWidth: 1, strokeLinejoin: "round" as const };
  switch (status) {
    case "no-change":
      return <circle r={r} {...common} />;
    case "moved-up":
      return <polygon points={trianglePointsUp(r * 1.2)} {...common} />;
    case "moved-down":
      return <polygon points={trianglePointsDown(r * 1.2)} {...common} />;
    case "new":
      return <polygon points={starPoints(r * 1.25)} {...common} />;
  }
}
