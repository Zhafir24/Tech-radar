# Tech Radar

An enterprise-grade, data-driven Tech Radar for 100+ technologies, built from
a self-hosted scraping pipeline. React 19 · TypeScript (strict) · Tailwind 4 ·
SVG.

One page — `http://localhost:5173/` — rendering the radar plus a pipeline
status bar. **The scraper is the single source of truth:** it writes
`public/radar-data.json`, and the radar renders exactly that, falling back to
the compiled-in `DEFAULT_RADAR_CONFIG` only when the file is unreachable.

You drive everything from the radar page itself: **Show details → Manage
sources** to add a website, toggle a built-in source, or hit **Rescrape now**.

## Quick start

Two paths — pick whichever fits.

### A. Portable release (Windows, no Node required)

Grab the latest `Tech-Radar-Portable-v*-windows-x64.zip` from
[Releases](https://github.com/Zhafir24/Tech-radar/releases), extract, and
double-click `Start Tech Radar.bat`. The radar opens at
`http://localhost:5173/`.

The zip is fully self-contained: bundled Node.js runtime, pre-installed
`node_modules`, current scrape data. Close the console window to stop the
server; run the `.bat` again to restart. Windows Defender may flag the
unsigned `node.exe` on first launch — "More info → Run anyway" proceeds.

The bundle launches through [scripts/serve-portable.mjs](scripts/serve-portable.mjs),
**not** [scripts/serve.mjs](scripts/serve.mjs). The latter reclaims port 5173
by force-killing whoever holds it, which is fine for a single dev machine but
wrong in distributed software: it would kill an unrelated program, and two
copies of it (say the autostart dev server plus an extracted bundle) kill each
other's Vite forever. The portable launcher instead takes the first free port
from 5173 upward, never terminates a process it does not own, opens the browser
on whichever port it settled on, and stops with a diagnosis after repeated
instant failures rather than looping.

To rebuild the bundle yourself:

```bash
npm run build:portable -- --out ./release
```

### B. From source (any OS)

```bash
git clone https://github.com/Zhafir24/Tech-radar.git
cd Tech-radar
npm install
npm run dev        # http://localhost:5173/
npm run build      # type-checks (tsc --noEmit) then bundles to dist/
npm run preview    # serve the production build
npm run scrape     # run the pipeline once from the CLI
npm run test:scrape
```

Requires Node.js ≥ 20.19 (developed on Node 24 / Vite 7).

`npm install` prints deprecation warnings from transitive dependencies and a
note that esbuild's postinstall is gated by npm's allow-scripts policy. Both
are expected and harmless — the build works regardless.

## Managing sources

Everything is on the radar page — click **Show details** in the status bar,
then **Manage sources**:

- **Built-in sources** — toggle dev.to, GitHub Trending, The Hacker News,
  InfoQ, Lobste.rs on or off.
- **Custom websites** — paste any URL and click **Add**. The name is optional
  (the domain is used if blank). Feeds are auto-detected; otherwise the
  homepage is scraped for article links. JavaScript-only sites may yield 0
  items.
- **Rescrape now** — runs the pipeline immediately; progress streams into the
  dialog footer and the radar refreshes itself when the run finishes.

The `/api/sources` and `/api/scrape` endpoints backing this dialog are Vite
dev-server middleware ([scripts/api/sources-api.mjs](scripts/api/sources-api.mjs)),
so they exist only while the dev server runs. A statically deployed `dist/`
has no backend, and the dialog reports that clearly instead of failing
silently.

## Project structure

```
src/
├── App.tsx                          # Fetches /radar-data.json, renders the page
├── main.tsx
├── index.css                        # Tailwind, Inter font, interaction CSS
└── components/
    ├── PipelineStatus.tsx           # Status bar + expandable diagnostics panel
    ├── ManageSourcesModal.tsx       # Add/toggle sources, trigger a rescrape
    └── TechRadar/
        ├── index.ts                 # Public barrel export
        ├── TechRadar.tsx            # Card + responsive grid (radar + 4 legends + key)
        ├── RadarSVG.tsx             # Single square SVG composition
        ├── RadarRing.tsx            # One concentric maturity ring
        ├── RadarAxis.tsx            # Dashed crosshair + center point
        ├── RadarLabel.tsx           # Ring labels (EMERGING/ASSESS/TRIAL/ADOPT)
        ├── RadarBlip.tsx            # Circle / triangle / star + number
        ├── RadarLegend.tsx          # Corner quadrant legend (icon + ring lists)
        ├── MovementLegend.tsx       # Key: Moved up / down / New / No change
        ├── CategoryIcon.tsx         # Outline glyphs (server/ai/shield/database)
        ├── Tooltip.tsx              # Lazy HTML tooltip overlaid on the SVG
        ├── radarConfig.ts           # DEFAULT_RADAR_CONFIG + resolveBlips()
        ├── types.ts                 # Type model, RadarSnapshot, STATUS_COLORS
        └── utils/
            ├── polar.ts             # Polar ↔ Cartesian
            ├── random.ts            # FNV-1a hash + mulberry32 PRNG
            ├── shapes.ts            # Triangle / star point generators
            └── scatter.ts           # Deterministic scatter + Lloyd relaxation

scripts/
├── scrape/                          # The pipeline (fetch → normalize → score → write)
├── api/sources-api.mjs              # /api/sources + /api/scrape dev middleware
├── serve.mjs                        # Dev supervisor (reclaims port 5173)
├── serve-portable.mjs               # Bundle launcher (takes first FREE port)
└── build-portable.mjs               # Builds the extract-and-run Windows bundle
```

## Data model

The radar is fully driven by `RadarConfig`. Every blip is a `BlipDefinition`:

```ts
{
  id: "kubernetes",
  number: 3,
  name: "Kubernetes",
  ring: "adopt",              // "adopt" | "trial" | "assess" | "emerging"
  quadrant: "infrastructure", // "infrastructure" | "ai-automation" | "security" | "data-integration"
  status: "no-change",        // "no-change" | "moved-up" | "moved-down" | "new"
  // angle? / radiusFraction? optional manual placement
}
```

There are no hardcoded coordinates in the config. The scatter algorithm
(`utils/scatter.ts`) assigns each blip a stable, deterministic position
inside its `(quadrant × ring)` segment.

## Design rationale

- **Single square SVG viewBox** centered on the radar (`outerRadius + pad`
  on each side). One coordinate space for rings, crosshair, labels and
  blips means the circles stay perfectly circular and every proportion of
  the reference layout is preserved at any rendered size.
- **Deterministic scatter with Lloyd-style relaxation.** Blips get a
  stratified angular slot in their quadrant + area-uniform radial position,
  seeded per blip id (FNV-1a → mulberry32). A few rounds of push-apart
  relaxation, each followed by a segment re-projection, enforce a minimum
  spacing without letting blips drift out of their ring or quadrant.
- **Shape encodes status.** Circle = no change (ring-colored), up-triangle =
  moved up (green), down-triangle = moved down (red), star = new (blue).
  Numbers are always centered inside the shape with a paint-order halo for
  contrast.
- **Corner legends, not SVG labels.** Quadrant labels and ring-grouped item
  lists live in HTML in the four corners of the card — freeing the SVG for
  the radar itself and letting the legends reflow naturally.
- **HTML tooltip over SVG.** Positioned with percentages of the SVG's
  viewBox rectangle so it tracks its blip at every rendered size without any
  measurement code. Flips above/below near the top edge; only mounted while
  a blip is hovered/focused (lazy rendering).
- **CSS-only motion.** Hover/focus scale is a ~150 ms CSS transition — 60
  fps, no animation library, fully disabled under `prefers-reduced-motion`.

## Responsive behavior

- **≥ 1280 px:** 3-column layout with infra / security on the left, radar
  in the middle, ai / data on the right.
- **640 – 1279 px:** radar on top, four legends beneath in a 2-column grid.
- **< 640 px:** everything stacks vertically; right-aligned quadrants
  flip back to left-aligned for readability.

Circles stay perfectly circular at every size (single square viewBox +
`h-auto`).

## Accessibility

- Every blip is a `role="button"` with `tabindex="0"`, a descriptive
  `aria-label` (number, name, ring, quadrant, status), and `aria-pressed`
  for selection.
- Keyboard: `Tab` cycles blips (tooltip shows on focus), `Enter`/`Space`
  toggles selection, `Escape` clears it. Focused/selected blips get a
  visible indicator ring.
- Reduced-motion honored.

## Performance

- All 81 blip positions are resolved once per config (`useMemo`); every
  subcomponent is `React.memo`-ized so hover/focus only re-renders the
  affected blip and the tooltip.
- Shadows are shared `feDropShadow` filters; no layout thrashing (tooltip
  positioning is pure CSS percentages).

## Extensibility

Everything comes from `RadarConfig`:

- **Add a technology** — append a `BlipDefinition` to `blips`; the scatter
  algorithm picks a stable position automatically.
- **Rename rings/quadrants, change colors** — edit `rings` / `quadrants`.
- **Reuse elsewhere** — `<TechRadar config={yourConfig} />`; the component
  has no external state and one optional prop.

Natural next steps: quadrant filtering, search, per-quadrant zoom, an
edition-comparison view driven by `status`.
