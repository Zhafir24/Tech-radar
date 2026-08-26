import { useCallback, useMemo, useState } from "react";
import type { RadarConfig } from "./types";
import { DEFAULT_RADAR_CONFIG, resolveBlips } from "./radarConfig";
import { RadarSVG } from "./RadarSVG";
import { Tooltip } from "./Tooltip";
import { RadarLegend } from "./RadarLegend";
import { MovementLegend } from "./MovementLegend";

/** Format an ISO date for the header subtitle. Falls back to the raw string. */
function formatUpdatedAt(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export interface TechRadarProps {
  /** Full radar configuration; defaults to the reference layout. */
  config?: RadarConfig;
  /** Page title shown above the radar. */
  title?: string;
  /** Version / edition string shown under the title. */
  version?: string;
  /** ISO timestamp of the last data update — renders next to the version. */
  updatedAt?: string | null;
  className?: string;
  /**
   * Controlled selection. When provided (including null), the component
   * no longer manages selection internally — the parent owns it. Omit it
   * (as the app does) to let the radar track selection itself.
   */
  selectedId?: string | null;
  /** Fires whenever a blip is selected (id) or deselected (null). */
  onSelectBlip?: (id: string | null) => void;
  /** Render the four corner quadrant legends (default true). */
  showLegends?: boolean;
  /** Render the title/version header (default true). */
  showHeader?: boolean;
}

/**
 * Zalando-style Tech Radar.
 *
 * Plain page layout (no card wrapper): a title header, two narrow legend
 * columns flanking a large center radar, and a movement key at the bottom.
 * Below the `xl` breakpoint everything stacks: title, radar, legends grid,
 * movement key.
 *
 * With `showLegends={false}` only the radar + movement key render, a compact
 * form suitable for embedding the radar as a preview.
 */
export function TechRadar({
  config = DEFAULT_RADAR_CONFIG,
  title = "Tech Radar",
  version = "2026.05",
  updatedAt,
  className = "",
  selectedId: selectedIdProp,
  onSelectBlip,
  showLegends = true,
  showHeader = true,
}: TechRadarProps) {
  const blips = useMemo(() => resolveBlips(config), [config]);
  const visibleBlips = useMemo(() => blips.filter((b) => !b.hidden), [blips]);

  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const [internalSelectedId, setInternalSelectedId] = useState<string | null>(null);

  const isControlled = selectedIdProp !== undefined;
  const selectedId = isControlled ? selectedIdProp : internalSelectedId;

  const handleSelect = useCallback(
    (id: string) => {
      const next = selectedId === id ? null : id;
      if (!isControlled) setInternalSelectedId(next);
      onSelectBlip?.(next);
    },
    [selectedId, isControlled, onSelectBlip],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === "Escape") {
        if (!isControlled) setInternalSelectedId(null);
        onSelectBlip?.(null);
      }
    },
    [isControlled, onSelectBlip],
  );

  const activeId = hoveredId ?? focusedId;
  const activeBlip = useMemo(
    () =>
      activeId ? (visibleBlips.find((b) => b.id === activeId) ?? null) : null,
    [activeId, visibleBlips],
  );

  const [infra, ai, dataInt, security] = config.quadrants;

  // viewBox rectangle of RadarSVG in radar coordinates — used to position
  // the tooltip inside the SVG container. Must match `pad` in RadarSVG.
  const pad = 6;
  const vbSize = (config.outerRadius + pad) * 2;
  const tooltipViewBox = {
    x: config.center.x - config.outerRadius - pad,
    y: config.center.y - config.outerRadius - pad,
    width: vbSize,
    height: vbSize,
  };

  const header = showHeader ? (
    <header className="mb-8">
      <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1>
      <p className="mt-1 text-sm text-slate-500">
        <span>{version}</span>
        {updatedAt && (
          <>
            <span aria-hidden="true" className="mx-1.5 text-slate-300">·</span>
            <span>Updated {formatUpdatedAt(updatedAt)}</span>
          </>
        )}
      </p>
    </header>
  ) : null;

  const radarSurface = (
    <div className="relative mx-auto w-full max-w-[1200px]">
      <RadarSVG
        config={config}
        blips={visibleBlips}
        selectedId={selectedId}
        focusedId={focusedId}
        onHover={setHoveredId}
        onFocus={setFocusedId}
        onSelect={handleSelect}
      />
      {activeBlip && (
        <Tooltip blip={activeBlip} config={config} viewBox={tooltipViewBox} />
      )}
    </div>
  );

  if (!showLegends) {
    return (
      <div
        className={`w-full ${className}`}
        style={{ color: config.textColor }}
        onKeyDown={handleKeyDown}
      >
        {header}
        {radarSurface}
        <div className="mt-6">
          <MovementLegend config={config} />
        </div>
      </div>
    );
  }

  return (
    <div
      className={`mx-auto w-full max-w-[1920px] px-4 py-6 sm:px-6 sm:py-6 ${className}`}
      style={{ color: config.textColor }}
      onKeyDown={handleKeyDown}
    >
      {header}

      {/*
        Grid — legend widths chosen so all item names fit while giving the
        radar the majority of the horizontal space.
      */}
      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(230px,260px)_minmax(0,4fr)_minmax(230px,260px)] xl:gap-5">
        {/* Radar column — full width on mobile, middle column on desktop. */}
        <div className="relative order-1 xl:order-2 xl:row-span-2">
          {radarSurface}
          <div className="mt-6">
            <MovementLegend config={config} />
          </div>
        </div>

        {/*
          Corner legends. On narrow screens all four fall into a 2-column
          grid below the radar; at xl+ they occupy the four corners.
        */}
        <div className="order-2 grid grid-cols-1 gap-8 sm:grid-cols-2 xl:contents">
          <div className="xl:order-1">
            <RadarLegend quadrant={infra} config={config} align="left" />
          </div>
          <div className="xl:order-3">
            <RadarLegend quadrant={ai} config={config} align="right" />
          </div>
          <div className="xl:order-4">
            <RadarLegend quadrant={security} config={config} align="left" />
          </div>
          <div className="xl:order-5">
            <RadarLegend quadrant={dataInt} config={config} align="right" />
          </div>
        </div>
      </div>
    </div>
  );
}
