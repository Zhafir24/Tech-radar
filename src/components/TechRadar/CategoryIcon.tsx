import { memo, type ReactNode } from "react";
import type { CategoryIconId } from "./types";

/**
 * Thin-stroke outline glyphs drawn on a 24 × 24 grid.
 * Exported as a subcomponent so the legend header can reuse the same paths
 * inside a standalone HTML `<svg>` element.
 */
const ICON_GLYPHS: Record<CategoryIconId, ReactNode> = {
  server: (
    <>
      <rect x="3" y="3.2" width="18" height="4.8" rx="1.6" />
      <rect x="3" y="9.6" width="18" height="4.8" rx="1.6" />
      <rect x="3" y="16" width="18" height="4.8" rx="1.6" />
      <path d="M6.2 5.6h.01M8.8 5.6h.01M6.2 12h.01M8.8 12h.01M6.2 18.4h.01M8.8 18.4h.01" />
      <path d="M14.5 5.6H18M14.5 12H18M14.5 18.4H18" />
    </>
  ),
  ai: (
    <>
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96.44 2.5 2.5 0 0 1-2.96-3.08 3 3 0 0 1-.34-5.58 2.5 2.5 0 0 1 1.32-4.24 2.5 2.5 0 0 1 1.98-3A2.5 2.5 0 0 1 9.5 2Z" />
      <path d="M12 7h3.6" />
      <circle cx="16.9" cy="7" r="1.3" />
      <path d="M12 12h5.6" />
      <circle cx="18.9" cy="12" r="1.3" />
      <path d="M12 17h3.6" />
      <circle cx="16.9" cy="17" r="1.3" />
    </>
  ),
  shield: (
    <>
      <path d="M12 2.5c2 1.5 4.4 2.4 7 2.6v5.9c0 4.7-2.9 7.9-7 9.6-4.1-1.7-7-4.9-7-9.6V5.1c2.6-.2 5-1.1 7-2.6Z" />
      <rect x="9.3" y="10.6" width="5.4" height="4.3" rx="1" />
      <path d="M10.6 10.6V9.4a1.4 1.4 0 0 1 2.8 0v1.2" />
    </>
  ),
  database: (
    <>
      <ellipse cx="12" cy="5.2" rx="7.5" ry="2.7" />
      <path d="M4.5 5.2v13.6c0 1.5 3.35 2.7 7.5 2.7s7.5-1.2 7.5-2.7V5.2" />
      <path d="M4.5 10c0 1.5 3.35 2.7 7.5 2.7s7.5-1.2 7.5-2.7" />
      <path d="M4.5 14.5c0 1.5 3.35 2.7 7.5 2.7s7.5-1.2 7.5-2.7" />
    </>
  ),
};

interface CategoryIconProps {
  icon: CategoryIconId;
  /** Center X of the icon container in the parent SVG. */
  cx: number;
  /** Center Y of the icon container in the parent SVG. */
  cy: number;
  color: string;
}

const CONTAINER_RADIUS = 33;
const ICON_SCALE = 1.55;

/**
 * SVG version of the category icon: outline glyph centered inside a soft
 * white circular container with a subtle border and shadow. Used inside
 * the radar SVG.
 */
export const CategoryIcon = memo(function CategoryIcon({
  icon,
  cx,
  cy,
  color,
}: CategoryIconProps) {
  const offset = 12 * ICON_SCALE;
  return (
    <g aria-hidden="true">
      <circle
        cx={cx}
        cy={cy}
        r={CONTAINER_RADIUS}
        fill="#FFFFFF"
        stroke="#EDF0F5"
        strokeWidth={1}
        filter="url(#radar-icon-shadow)"
      />
      <g
        transform={`translate(${cx - offset} ${cy - offset}) scale(${ICON_SCALE})`}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {ICON_GLYPHS[icon]}
      </g>
    </g>
  );
}) as React.MemoExoticComponent<React.FC<CategoryIconProps>> & {
  /** Bare glyph paths for reuse inside another SVG (e.g. legend headers). */
  Glyph: React.FC<{ icon: CategoryIconId }>;
};

CategoryIcon.Glyph = function CategoryIconGlyph({ icon }) {
  return <>{ICON_GLYPHS[icon]}</>;
};
