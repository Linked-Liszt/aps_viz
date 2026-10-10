# APS-U Beamline Explorer

An interactive, museum-exhibit-style 3D visualization of the **Advanced Photon Source Upgrade (APS-U)** at Argonne
National Laboratory. Start above the whole facility, then fly into any of the nine APS-U **feature beamlines** to walk
the X-ray path from the undulator to the detector, read what every component does, and play with an interactive
"station" that demonstrates the technique and the new science the upgraded source enables.

Built with [three.js](https://threejs.org), TypeScript and Vite. No framework; the UI is plain DOM.

```bash
pnpm install
pnpm dev        # http://127.0.0.1:5173
pnpm build      # typecheck + production build in dist/
pnpm test       # data-integrity, copy, router and physics unit tests (vitest)
pnpm e2e        # Playwright interaction tests (own dev server on :5190; set E2E_PORT to change)
```

Runs on integrated laptop GPUs: rendering quality has three tiers (High / Balanced / Light, ⚙ settings) and an
adaptive governor steps down if the frame rate stays low. Detailed beamline scenes are statically batched once the
camera settles (hundreds of draw calls instead of thousands).

## What's in it

| Layer | What you can do |
| --- | --- |
| **The APS** (overview) | Orbit the facility, built from OpenStreetMap footprints (ring building, LOMs, injector, Long Beamline Building). Watch electron bunches circulate. Hover any sector to see what runs there; click a glowing feature beamline to step inside. |
| **Feature beamlines** | True-distance 3D models generated from researched dossiers: undulators, front end, ratchet wall, cut-away hutches, mirrors, monochromators, focusing optics, instruments, detectors. White → monochromatic beam, scattering cones, scale figures, a distance ruler and a "subway map" strip of every component. |
| **Exhibit panel** | Overview · How it works (interactive station) · Inside (component by component) · Science · Specs & sources (design-record figures, parameters, references). |
| **Visitor / Specialist** | One switch changes every text from plain language to dense technical detail with specs and caveats. |
| **Guided tour** | Injector → new storage ring → undulators → each feature beamline → Long Beamline Building. |
| **The upgrade** | A plain-language primer, stations on the multi-bend-achromat lattice, brightness, undulators and coherence, an APS-vs-APS-U *By the numbers* comparison, and a timeline. |
| **Every other sector** | Hover or click any of the 35 beamline sectors for its beamlines, operators, status and — for the 15 enhanced sectors — what the upgrade changed. |
| **Search** | `/` or `Ctrl+K` finds beamlines, components, techniques and sectors. |

Keyboard: `Esc` back · `[` `]` previous/next component · `F` frame · `R` ride the beam · `T` tour · `V` depth ·
`1–9` beamlines · `/` search · `?` help. With the 3D view focused: arrows orbit, `Shift`+arrows pan, `+`/`−` or
`PgUp`/`PgDn` zoom, `Home` re-frames. Dialogs trap focus, panels use proper tab semantics, and
`prefers-reduced-motion` freezes the animated beams, bunches and stations.
Deep links: `#/beamline/xpcs`, `#/beamline/3dmn/<component-id>`, `#/tour/3`, `#/sector/12`.

## Where the content comes from

Every beamline is described by a dossier in `src/data/beamlines/<id>.json`, researched from public sources and
fact-checked by a second pass: the APS-U *Final Design Report* (2019) and *Preliminary Design Report* (2017),
APS web pages, and newer publications (MEDSI, SRI, J. Synchrotron Rad., RSI, APS news). Each component carries a
`source` reference and each dossier lists its references, open questions and the 2026 status. Site geometry
(`src/data/site.json`) is derived from OpenStreetMap footprints plus documented ring parameters
(see `scripts/build-site.py`).

The facility story (*By the numbers*, *Timeline*, *Primer*) and the 35 sector cards are generated from the
fact-checked facility and sector research dossiers. Exhibit wording — plain-language rewrites, visitor `plain`
variants, status phrasing, plain sector labels and typography — lives in `scripts/exhibit-overrides/*.json`, which the
build scripts apply on top of the research (a stale override key is an error). Never hand-edit the generated JSON;
edit the overrides and rebuild:

```bash
python3 scripts/build-facility.py research/facility.json src/data/facility.json
python3 scripts/build-sectors.py  research/sectors.json  src/data/sectors.json
python3 scripts/build-site.py     research/site.json     src/data/site.json
```

The full fact-checked research dossiers (with their `verification` blocks, open questions and every reference) are
kept in `research/`; the exhibit dossiers in `src/data/beamlines/` are curated from them.

Tour, overview and stat copy is curated in `src/data/tour.ts` and `src/data/copy.ts`. One framing is used
everywhere: the upgraded APS is about 500× brighter (100–1000× depending on X-ray energy; ×540 at 20 keV in the
design), and the user-mode source is about 12 × 8 µm rms.

This is an independent educational visualization, **not an official APS or Argonne product**. Hutch geometry outside
the feature beamlines is schematic; component models are simplified, with realistic sizes and true distances along
the beam.

## Code map

```
src/
  app/        App controller (routing, camera choreography), store (hash router + preferences)
  scene/      Stage (renderer, bloom, quality tiers, camera flights, picking), palette, fat lines
    site/     Site (ring building, ratchet wall, H7BA lattice, LOMs, injector, trees, beamline overview)
    beamline/ BeamlineScene (dossier → 3D), layout API (layout.ts documents every option), parametric parts,
              static batching (batch.ts), label/pin decluttering (labels.ts)
  beamlines/  <id>.layout.ts — per-beamline geometry: branches, off-axis instruments, hero models
  ui/         TopBar, OverviewPanel, BeamlinePanel, PathStrip, tour/intro/help overlays
    explainers/  interactive stations (one module each) + shared station kit
  data/       dossiers (JSON), site, sectors, facility, tour copy, types
  lib/        dom helpers, tweens, FFT/RNG/Poisson
tests/        dossier validation, copy/router checks, physics unit tests
e2e/          Playwright interaction tests
research/     fact-checked research dossiers (source of truth for the generated data)
scripts/      build-site / build-sectors / build-facility (+ exhibit-overrides/), compress-figures, shot.mjs
```

Development helpers: station harness `/explainer.html?id=xpcs&depth=specialist`; screenshots
`node scripts/shot.mjs '#/beamline/xpcs' out.png` (append `?nobatch` to the URL to compare without static batching).
