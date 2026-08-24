# Tech Radar

An enterprise-grade, data-driven Tech Radar for 80+ technologies, plus a
connected **admin console** for managing it. React 19 · TypeScript (strict) ·
Tailwind 4 · SVG.

Two entry points (Vite multi-page app):

| Page | Dev URL | Purpose |
|---|---|---|
| Public radar | http://localhost:5173/ | Renders the radar + pipeline status; **Manage sources** lives here |
| Admin console | http://localhost:5173/admin.html | Edit the **draft**, then publish |

The public page resolves its data in priority order: the **published**
snapshot from localStorage (admin override), then `/radar-data.json` written
by the scraper, then the compiled-in `DEFAULT_RADAR_CONFIG`. Radar-only
builds skip step 1 entirely.

The admin edits a draft (autosaved to `localStorage["pnm-radar-draft"]`);
**Publish** copies it to `localStorage["pnm-radar-published"]`, which the
public page renders (and live-reloads via a `storage` listener when both are
open on the same origin). To host the admin on a separate domain in
production, deploy `dist/admin.html` behind e.g. `admin.example.com` and
replace `src/components/TechRadar/persistence.ts` with an API client —
localStorage does not cross origins, so a backend becomes mandatory there.

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

**From v1.5 the portable bundle is radar-only** — it ships without the admin
console (see [Build variants](#build-variants)). Everything you need to drive
the radar lives on the radar page itself: *Show details → Manage sources* to
add a website, toggle a source, or hit **Rescrape now**.

### Build variants

```bash
npm run build:portable -- --out ./release              # radar-only (default)
npm run build:portable -- --out ./release --with-admin # radar + admin console
```

The radar-only variant omits `src/admin/` and `admin.html`, and sets
`VITE_RADAR_ONLY=true` in the staged app. That flag also makes
[src/App.tsx](src/App.tsx) ignore the `pnm-radar-published` localStorage
override: that key exists purely so the admin console can pin a curated
snapshot, and with no admin console shipped there would be no UI to clear
it — a snapshot left behind by a full build (same origin, therefore the same
localStorage) would otherwise freeze the radar on stale data.

### B. From source (any OS)

```bash
git clone https://github.com/Zhafir24/Tech-radar.git
cd Tech-radar
npm install
npm run dev        # public: /   admin: /admin.html
npm run build      # type-checks (tsc --noEmit) then bundles both entries to dist/
npm run preview    # serve the production build
```

Requires Node.js ≥ 20.19 (developed on Node 24 / Vite 7).

## Admin console

- **Dashboard** — publish state, item counts, distribution, live mini preview.
- **Items** — searchable/filterable/sortable table of all 81 entries with bulk
  select (hide/show/move ring/delete), pagination, kebab actions, an Item
  Details panel, and analytics cards (donut by ring, bars by quadrant,
  movement summary).
- **Radar Editor** — the real `TechRadar` component rendering the draft;
  clicking a blip opens the inspector (name, ring, quadrant, movement,
  visibility, description, since/owner, auto vs. manual polar position with
  bounded sliders). Every edit re-renders the radar instantly.
- **Configuration** — radar title/version, blip size, ring labels + colors,
  quadrant labels, publish/discard, JSON export/import, CSV export, reset.
- **Workflow** — autosaved draft, unsaved-changes bar with Discard/Publish,
  toasts, confirmation dialogs. Sidebar entries marked "Soon" (Reports, Users,
  …) are visual stubs from the reference mockup, not functional pages.

## Project structure

```
src/
├── App.tsx                          # Page shell (centers the radar card)
├── main.tsx
├── index.css                        # Tailwind, Inter font, interaction CSS
└── components/TechRadar/
    ├── index.ts                     # Public barrel export
    ├── TechRadar.tsx                # Card + responsive grid (radar + 4 legends + key)
    ├── RadarSVG.tsx                 # Single square SVG composition
    ├── RadarRing.tsx                # One concentric maturity ring
    ├── RadarAxis.tsx                # Dashed crosshair + center point
    ├── RadarLabel.tsx               # Ring labels (EMERGING/ASSESS/TRIAL/ADOPT)
    ├── RadarBlip.tsx                # Circle / triangle-up / triangle-down / star + number
    ├── RadarLegend.tsx              # Corner quadrant legend (icon + 2-col ring lists)
    ├── MovementLegend.tsx           # Bottom key: Moved up / down / New / No change
    ├── CategoryIcon.tsx             # Outline glyphs (server / ai / shield / database)
    ├── Tooltip.tsx                  # Lazy HTML tooltip overlaid on the SVG
    ├── radarConfig.ts               # DEFAULT_RADAR_CONFIG + resolveBlips()
    ├── types.ts                     # Full type model + STATUS_COLORS
    └── utils/
        ├── polar.ts                 # Polar ↔ Cartesian
        ├── random.ts                # FNV-1a hash + mulberry32 PRNG
        └── scatter.ts               # Deterministic scatter with Lloyd relaxation
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
