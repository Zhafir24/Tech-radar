import { memo } from "react";
import type { RadarConfig, ResolvedBlip } from "./types";

interface TooltipProps {
  blip: ResolvedBlip;
  config: RadarConfig;
  /** viewBox origin of the RadarSVG (top-left in radar coordinates). */
  viewBox: { x: number; y: number; width: number; height: number };
}

/**
 * HTML tooltip overlaid on the SVG. Positioned with percentages of the
 * RadarSVG's viewBox so it tracks its blip at every rendered size without
 * measurement. Rendered lazily — only mounted while a blip is hovered
 * or focused.
 */
export const Tooltip = memo(function Tooltip({ blip, config, viewBox }: TooltipProps) {
  const relX = ((blip.x - viewBox.x) / viewBox.width) * 100;
  const relY = ((blip.y - viewBox.y) / viewBox.height) * 100;
  const offsetPct = (config.blipStyle.hitRadius / viewBox.height) * 100;

  // Flip below the blip when it sits near the top edge of the SVG.
  const below = relY < 15;

  const statusLabel: Record<ResolvedBlip["status"], string> = {
    "no-change": "No change",
    "moved-up": "Moved up",
    "moved-down": "Moved down",
    new: "New",
  };

  return (
    <div
      id="radar-tooltip"
      role="tooltip"
      className={`radar-tooltip ${below ? "radar-tooltip--below" : ""} pointer-events-none absolute z-10 w-max max-w-[min(280px,76vw)] rounded-xl bg-slate-900/95 px-4 py-3 text-left shadow-xl`}
      style={{
        left: `${relX.toFixed(3)}%`,
        top: `calc(${relY.toFixed(3)}% ${below ? "+" : "-"} ${offsetPct.toFixed(3)}%)`,
      }}
    >
      <p className="text-[13px] font-semibold leading-tight text-white">
        <span className="mr-1 opacity-70">{blip.number}.</span>
        {blip.name}
      </p>
      <p
        className="mt-1 text-[10px] font-bold uppercase tracking-[0.08em]"
        style={{ color: blip.color }}
      >
        {blip.ringLabel} · {blip.quadrantLabel}
      </p>
      {blip.status !== "no-change" && (
        <p className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.06em] text-slate-400">
          {statusLabel[blip.status]}
        </p>
      )}
      {blip.description && (
        <p className="mt-1.5 text-xs leading-snug text-slate-300">
          {blip.description}
        </p>
      )}
      <span
        aria-hidden="true"
        className={`absolute left-1/2 h-2.5 w-2.5 -translate-x-1/2 rotate-45 bg-slate-900/95 ${
          below ? "-top-1" : "-bottom-1"
        }`}
      />
    </div>
  );
});
