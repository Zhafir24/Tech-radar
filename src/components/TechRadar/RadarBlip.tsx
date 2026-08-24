import { memo } from "react";
import type { BlipStyle, MovementStatus, ResolvedBlip } from "./types";
import { starPoints, trianglePointsDown, trianglePointsUp } from "./utils/shapes";

interface RadarBlipProps {
  blip: ResolvedBlip;
  style: BlipStyle;
  isSelected: boolean;
  isFocused: boolean;
  onHover: (id: string | null) => void;
  onFocus: (id: string | null) => void;
  onSelect: (id: string) => void;
}

/**
 * Fill color for a blip's shape — always the ring color (Zalando-style).
 * The SHAPE conveys movement status; the COLOR conveys the ring. Keeping
 * these dimensions orthogonal means an ADOPT blip is always green, whether
 * it's a "moved up" triangle or a "no change" circle, so status colors
 * never collide with ring colors.
 */
function fillFor(blip: ResolvedBlip): string {
  return blip.color;
}

/**
 * Text color for the number badge — always white on the colored shape.
 * Slight dark shadow via `paint-order: stroke` improves contrast on the
 * lighter fills (green, orange).
 */
const NUMBER_COLOR = "#FFFFFF";
const NUMBER_HALO = "rgba(15, 23, 42, 0.35)";

/**
 * Vertical offset applied to the number so it sits at the visual centroid
 * of triangle/star shapes (their centroids are not at the geometric center).
 */
function numberOffsetY(status: MovementStatus, size: number): number {
  switch (status) {
    case "moved-up":
      return size * 0.18; // Triangle-up: centroid is below geometric center
    case "moved-down":
      return -size * 0.18; // Triangle-down: centroid is above
    case "new":
      return size * 0.02; // Star: slight nudge for optical centering
    default:
      return 0;
  }
}

/**
 * Shape SVG element for a blip. Rendered inside `.radar-blip__disc` so
 * hover/focus can scale the whole shape without disturbing the number.
 */
function BlipShape({
  blip,
  style,
}: {
  blip: ResolvedBlip;
  style: BlipStyle;
}) {
  const fill = fillFor(blip);
  const size = style.radius;
  const stroke = "#FFFFFF";
  const strokeWidth = style.borderWidth;

  switch (blip.status) {
    case "no-change":
      return (
        <circle
          r={size}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
        />
      );
    case "moved-up":
      // Triangle inscribed in a circle of radius ~1.15·size so its optical
      // weight matches the reference circle.
      return (
        <polygon
          points={trianglePointsUp(size * 1.2)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      );
    case "moved-down":
      return (
        <polygon
          points={trianglePointsDown(size * 1.2)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      );
    case "new":
      return (
        <polygon
          points={starPoints(size * 1.25)}
          fill={fill}
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeLinejoin="round"
        />
      );
  }
}

/**
 * A single technology blip: shape (per status) + centered number badge.
 * Fully keyboard-operable (Tab to focus, Enter/Space to toggle selection).
 */
export const RadarBlip = memo(function RadarBlip({
  blip,
  style,
  isSelected,
  isFocused,
  onHover,
  onFocus,
  onSelect,
}: RadarBlipProps) {
  const showIndicator = isSelected || isFocused;
  const numberY = numberOffsetY(blip.status, style.radius);

  return (
    <g
      className="radar-blip"
      transform={`translate(${blip.x} ${blip.y})`}
      tabIndex={0}
      role="button"
      aria-pressed={isSelected}
      aria-label={`${blip.number}. ${blip.name} — ${blip.ringLabel} ring, ${blip.quadrantLabel}${
        blip.status !== "no-change" ? ` (${blip.status.replace("-", " ")})` : ""
      }`}
      onMouseEnter={() => onHover(blip.id)}
      onMouseLeave={() => onHover(null)}
      onFocus={() => onFocus(blip.id)}
      onBlur={() => onFocus(null)}
      onClick={() => onSelect(blip.id)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect(blip.id);
        }
      }}
    >
      {/* Enlarged invisible hit target for comfortable pointer interaction. */}
      <circle r={style.hitRadius} fill="transparent" />
      {showIndicator && (
        <circle
          r={style.hitRadius}
          fill="none"
          stroke={fillFor(blip)}
          strokeWidth={2}
          strokeOpacity={isSelected ? 0.85 : 0.5}
        />
      )}
      <g className="radar-blip__disc">
        <BlipShape blip={blip} style={style} />
        <text
          x={0}
          y={numberY}
          textAnchor="middle"
          dominantBaseline="central"
          fill={NUMBER_COLOR}
          stroke={NUMBER_HALO}
          strokeWidth={0.6}
          paintOrder="stroke"
          fontSize={style.numberFontSize}
          fontWeight={700}
          className="select-none pointer-events-none"
        >
          {blip.number}
        </text>
      </g>
    </g>
  );
});
