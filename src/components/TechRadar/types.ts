/**
 * Type definitions for the Tech Radar component system.
 *
 * All geometry is expressed in viewBox units of the radar SVG so the whole
 * composition scales proportionally at any rendered size.
 */

/** Ring identifiers, ordered innermost → outermost. */
export type RingId = "adopt" | "trial" | "assess" | "emerging";

export type QuadrantId =
  | "infrastructure"
  | "ai-automation"
  | "security"
  | "data-integration";

export type CategoryIconId = "server" | "ai" | "shield" | "database";

/**
 * Movement of a blip since the previous radar edition. Drives both the blip
 * shape (circle / triangle / star) and the semantic status color.
 */
export type MovementStatus = "no-change" | "moved-up" | "moved-down" | "new";

export interface RingDefinition {
  id: RingId;
  /** Uppercase ring label rendered on the vertical axis (e.g. "ADOPT"). */
  label: string;
  /** Ring radius, in viewBox units. */
  radius: number;
  /**
   * Distance from the radar center (upward along the vertical axis) at which
   * the ring label is centered.
   */
  labelRadius: number;
  colors: {
    /** Circle stroke color. */
    ring: string;
    /** Ring label text color. */
    label: string;
    /** Blip fill color for entries in this ring. */
    blip: string;
  };
}

export interface QuadrantDefinition {
  id: QuadrantId;
  /** Display label (e.g. "Infrastructure"), rendered uppercase in the legend. */
  label: string;
  icon: CategoryIconId;
  /**
   * Angular sector of the radar occupied by this quadrant, in degrees.
   * `0°` is 12 o'clock and angles increase clockwise, so AI & Automation
   * (top-right) is `{ min: 0, max: 90 }`.
   */
  angleRange: { min: number; max: number };
}

export interface BlipDefinition {
  id: string;
  /** Sequence number shown inside the blip and in the legend list. */
  number: number;
  name: string;
  ring: RingId;
  quadrant: QuadrantId;
  status: MovementStatus;
  /**
   * Optional manual override for the polar angle. When omitted the blip is
   * placed by the scatter algorithm within its quadrant's angle range.
   * `0°` = 12 o'clock, increasing clockwise.
   */
  angle?: number;
  /**
   * Optional manual override for the radial position, as a fraction (0..1)
   * of the outer ring radius.
   */
  radiusFraction?: number;
  description?: string;
  /** Hidden blips stay in the dataset but are not rendered on the radar. */
  hidden?: boolean;
  /** Radar edition in which the item first appeared (display metadata). */
  since?: string;
  /** ISO timestamp of the last update to this entry (display metadata). */
  updatedAt?: string;
  /** Team or person responsible for the entry (display metadata). */
  owner?: string;
}

/** A blip whose polar position has been resolved to Cartesian coordinates. */
export interface ResolvedBlip extends Required<Omit<BlipDefinition, "description">> {
  description?: string;
  x: number;
  y: number;
  color: string;
  ringLabel: string;
  quadrantLabel: string;
}

export interface AxisStyle {
  color: string;
  strokeWidth: number;
  dashArray: string;
}

export interface BlipStyle {
  /** Nominal half-size of the blip shape, in viewBox units. */
  radius: number;
  /** Width of the white border around the shape. */
  borderWidth: number;
  /** Radius of the (invisible) pointer hit target. */
  hitRadius: number;
  /** Number badge font size. */
  numberFontSize: number;
}

export interface ScatterOptions {
  /** Angle margin (degrees) inside each quadrant's `angleRange` boundary. */
  angleMargin: number;
  /** Radial margin (fraction of outerRadius) inside each ring band. */
  radiusMargin: number;
  /** Minimum spacing between blips, in viewBox units, enforced by relaxation. */
  minSpacing: number;
  /** Number of relaxation iterations. Higher = more even spacing. */
  relaxationIterations: number;
}

export interface RadarConfig {
  viewBox: { width: number; height: number };
  center: { x: number; y: number };
  /** Radius of the outermost ring; `radiusFraction` values are relative to it. */
  outerRadius: number;
  /** Card background — also used to halo ring labels over the dashed axis. */
  background: string;
  /** Primary dark-navy text color (quadrant labels, icons). */
  textColor: string;
  axis: AxisStyle;
  blipStyle: BlipStyle;
  scatter: ScatterOptions;
  rings: RingDefinition[];
  quadrants: QuadrantDefinition[];
  blips: BlipDefinition[];
}

/** Display metadata that accompanies a radar edition. */
export interface RadarMeta {
  title: string;
  version: string;
  /** ISO timestamp of the edition, or null if unknown. */
  publishedAt: string | null;
}

/**
 * On-the-wire shape of `public/radar-data.json`, written by the scraper
 * (see scripts/scrape/pipeline/write.mjs) and fetched by src/App.tsx.
 */
export interface RadarSnapshot {
  meta: RadarMeta;
  config: RadarConfig;
}

/**
 * Semantic colors for movement status, used regardless of the blip's ring.
 * `no-change` uses the ring color and is not listed here.
 *
 * Colors are chosen to be visually distinct from every ring color
 * (green = ADOPT, blue = TRIAL, orange = ASSESS, purple = EMERGING):
 *   - moved-up:   deep teal (blue-green, unlike ADOPT green or TRIAL blue)
 *   - moved-down: crimson (unlike any ring)
 *   - new:        magenta (unlike any ring)
 */
export const STATUS_COLORS: Record<Exclude<MovementStatus, "no-change">, string> = {
  "moved-up": "#0D9488",
  "moved-down": "#DC2626",
  new: "#DB2777",
};
