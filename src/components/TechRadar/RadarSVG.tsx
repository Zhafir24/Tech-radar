import { memo } from "react";
import type { RadarConfig, ResolvedBlip } from "./types";
import { RadarRing } from "./RadarRing";
import { RadarAxis } from "./RadarAxis";
import { RadarLabel } from "./RadarLabel";
import { RadarBlip } from "./RadarBlip";

interface RadarSVGProps {
  config: RadarConfig;
  blips: ResolvedBlip[];
  selectedId: string | null;
  focusedId: string | null;
  onHover: (id: string | null) => void;
  onFocus: (id: string | null) => void;
  onSelect: (id: string) => void;
}

/**
 * The radar itself as a single responsive SVG. Layered bottom to top:
 * subtle crosshair → gray concentric rings → faded watermark ring labels
 * → colored blips.
 *
 * Quadrant labels and category legends live in the surrounding HTML
 * (`RadarLegend`), not inside this SVG.
 */
export const RadarSVG = memo(function RadarSVG({
  config,
  blips,
  selectedId,
  focusedId,
  onHover,
  onFocus,
  onSelect,
}: RadarSVGProps) {
  const { center, outerRadius } = config;
  // Square viewBox that hugs the outer ring as tightly as possible so the
  // circle fills its container. Small pad keeps drop-shadows on edge blips
  // from clipping. Must match `pad` in TechRadar.tsx (tooltip alignment).
  const pad = 6;
  const size = (outerRadius + pad) * 2;
  const vbX = center.x - outerRadius - pad;
  const vbY = center.y - outerRadius - pad;

  return (
    <svg
      viewBox={`${vbX} ${vbY} ${size} ${size}`}
      className="block h-auto w-full font-sans"
      role="group"
      aria-label="Technology radar with four maturity rings (Adopt, Trial, Assess, Emerging) across four quadrants (Infrastructure, AI & Automation, Security, Data & Integration)"
    >
      <defs>
        <filter id="radar-blip-shadow" x="-80%" y="-80%" width="260%" height="260%">
          <feDropShadow
            dx="0"
            dy="1"
            stdDeviation="1.4"
            floodColor="#101828"
            floodOpacity="0.16"
          />
        </filter>
      </defs>

      <RadarAxis
        cx={center.x}
        cy={center.y}
        extent={outerRadius}
        style={config.axis}
      />

      {config.rings.map((ring) => (
        <RadarRing key={ring.id} ring={ring} cx={center.x} cy={center.y} />
      ))}

      {config.rings.map((ring) => (
        <RadarLabel key={ring.id} ring={ring} cx={center.x} cy={center.y} />
      ))}

      <g filter="url(#radar-blip-shadow)">
        {blips.map((blip) => (
          <RadarBlip
            key={blip.id}
            blip={blip}
            style={config.blipStyle}
            isSelected={selectedId === blip.id}
            isFocused={focusedId === blip.id}
            onHover={onHover}
            onFocus={onFocus}
            onSelect={onSelect}
          />
        ))}
      </g>
    </svg>
  );
});
