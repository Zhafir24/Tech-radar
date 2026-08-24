import { memo } from "react";
import type { QuadrantDefinition, RadarConfig, RingDefinition } from "./types";
import { blipsByRingForQuadrant } from "./radarConfig";
import { CategoryIcon } from "./CategoryIcon";

interface RadarLegendProps {
  quadrant: QuadrantDefinition;
  config: RadarConfig;
  /** Layout hint — determines column stacking order and heading alignment. */
  align?: "left" | "right";
}

/**
 * Zalando-style corner legend: plain bold quadrant heading, then a
 * two-column list of ring-grouped items (ADOPT/TRIAL in one column,
 * ASSESS/EMERGING in the other). No icons or containers — matches the
 * source design.
 */
export const RadarLegend = memo(function RadarLegend({
  quadrant,
  config,
  align = "left",
}: RadarLegendProps) {
  const ringGroups = blipsByRingForQuadrant(config, quadrant.id);
  const ringById = new Map<string, RingDefinition>(
    config.rings.map((r) => [r.id, r]),
  );

  const leftGroups = ringGroups.filter(
    (g) => g.ringId === "adopt" || g.ringId === "trial",
  );
  const rightGroups = ringGroups.filter(
    (g) => g.ringId === "assess" || g.ringId === "emerging",
  );

  // Alignment is only applied at `xl:` (matches the corner-quadrant layout).
  // At narrower widths the legends stack into a plain grid where everything
  // reads best left-aligned.
  const sectionClass =
    align === "right" ? "items-start xl:items-end" : "items-start";
  const listClass = align === "right" ? "xl:text-right" : "";

  return (
    <section
      aria-labelledby={`legend-${quadrant.id}-title`}
      className={`flex flex-col gap-4 ${sectionClass}`}
    >
      <header
        className={`flex items-center gap-3 ${
          align === "right" ? "xl:flex-row-reverse" : ""
        }`}
      >
        <span className="inline-flex h-11 w-11 items-center justify-center rounded-full border border-[#EDF0F5] bg-white shadow-[0_2px_6px_rgba(16,24,40,0.06)]">
          <IconSvg icon={quadrant.icon} color={config.textColor} />
        </span>
        <h3
          id={`legend-${quadrant.id}-title`}
          className="text-[15px] font-bold uppercase tracking-[0.06em]"
          style={{ color: config.textColor }}
        >
          {quadrant.label}
        </h3>
      </header>

      <div
        className={`grid grid-cols-2 gap-x-5 gap-y-4 text-[11.5px] leading-[1.4] ${listClass}`}
        style={{ color: config.textColor }}
      >
        <div className="flex flex-col gap-4">
          {leftGroups.map((group) => (
            <RingBlock
              key={group.ringId}
              ring={ringById.get(group.ringId)!}
              items={group.blips}
              align={align}
            />
          ))}
        </div>
        <div className="flex flex-col gap-4">
          {rightGroups.map((group) => (
            <RingBlock
              key={group.ringId}
              ring={ringById.get(group.ringId)!}
              items={group.blips}
              align={align}
            />
          ))}
        </div>
      </div>
    </section>
  );
});

interface RingBlockProps {
  ring: RingDefinition;
  items: Array<{ number: number; name: string }>;
  align: "left" | "right";
}

function RingBlock({ ring, items, align }: RingBlockProps) {
  const listClass = align === "right" ? "xl:text-right" : "";
  const headerClass =
    align === "right"
      ? "mb-1.5 flex items-center gap-1.5 xl:flex-row-reverse"
      : "mb-1.5 flex items-center gap-1.5";

  return (
    <div className={align === "right" ? "xl:text-right" : ""}>
      <div className={headerClass}>
        <span
          className="inline-block h-2 w-2 rounded-full"
          style={{ backgroundColor: ring.colors.blip }}
          aria-hidden="true"
        />
        <span
          className="text-[12px] font-bold uppercase tracking-[0.08em]"
          style={{ color: ring.colors.label }}
        >
          {ring.label}
        </span>
      </div>
      {items.length === 0 ? (
        <span className="text-[10.5px] italic opacity-45">—</span>
      ) : (
        <ol className={`${listClass} break-words`}>
          {items.map((item) => (
            <li key={item.number} className="leading-[1.35]">
              <span className="mr-1 tabular-nums opacity-70">{item.number}.</span>
              {item.name}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

/** Small standalone icon (HTML SVG element) used in the legend header. */
function IconSvg({ icon, color }: { icon: QuadrantDefinition["icon"]; color: string }) {
  return (
    <svg
      width={22}
      height={22}
      viewBox="0 0 24 24"
      fill="none"
      stroke={color}
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <CategoryIcon.Glyph icon={icon} />
    </svg>
  );
}
