# APS-U Beamline Explorer

An interactive 3D exhibit of the Advanced Photon Source Upgrade at Argonne National Laboratory. Explore the
facility, enter any of the nine APS-U feature beamlines, and follow the X-rays from the undulator to the detector.
Read about the optics and instruments, and try interactive stations on the scientific techniques used at each beamline.

The app uses [three.js](https://threejs.org), TypeScript and Vite. The interface uses DOM elements without a UI framework.

```bash
pnpm install
pnpm dev        # http://127.0.0.1:5173
pnpm build      # Typecheck and build production files in dist/
pnpm test       # Run data, copy, router and physics unit tests with Vitest
pnpm e2e        # Run Playwright tests on a separate server at port 5190
```

Use Node.js 26.7.0 and pnpm 9.15.9. `.node-version` and `package.json` record these versions. Install dependencies
with `pnpm install --frozen-lockfile` to use the committed lockfile.

Set `E2E_PORT` to use another port for Playwright. Rendering settings are High, Balanced and Light. The app lowers
rendering quality if the frame rate stays low. On integrated laptop GPUs, use Light. Once the camera stops moving,
the app combines static meshes to reduce thousands of draw calls to hundreds. It builds beamline models in small tasks
while the camera moves. It retains two completed models so recent beamlines reopen without rebuilding.

## Deploying to Cloudflare Pages

The production site is static. `pnpm run build` writes the HTML, JavaScript, CSS, fonts and selected figures to
`dist/`. No server, API keys or data-generation scripts are needed for deployment. The build uses the data already
committed under `src/data/` and does not read `.work/`.

1. Push the `main` branch to GitHub.
2. In Cloudflare, open Workers & Pages, then Create application, Pages and Connect to Git.
3. Connect GitHub and select `Linked-Liszt/aps_viz`.
4. Set the project name to `aps-viz`, or another available name, and use these build settings:

| Setting | Value |
| --- | --- |
| Production branch | `main` |
| Framework preset | None |
| Build command | `pnpm run build` |
| Build output directory | `dist` |
| Root directory | Leave blank |
| Environment variable | `NODE_VERSION=26.7.0` |
| Environment variable | `PNPM_VERSION=9.15.9` |

Set both version variables for production and preview builds. Cloudflare can also read the Node version from
`.node-version`. Set `PNPM_VERSION` explicitly because the current Pages build system does not infer it from the
lockfile. Cloudflare installs dependencies before running the build command.

5. Select Save and Deploy. The address will be `https://<project-name>.pages.dev`. Future pushes to `main` deploy
   automatically. Add a custom domain through the project's Custom domains settings when ready.

For pageviews, open the Pages project's Metrics tab and enable Web Analytics. Cloudflare adds its analytics
script on the next deployment, so redeploy after enabling it. No analytics token needs to be committed.

See Cloudflare's [Git integration guide](https://developers.cloudflare.com/pages/get-started/git-integration/),
[build image settings](https://developers.cloudflare.com/pages/configuration/build-image/) and
[Web Analytics instructions](https://developers.cloudflare.com/pages/how-to/web-analytics/).

To check the production build locally, run `pnpm run preview --host 127.0.0.1` after building. Check the welcome
dialog, a direct link such as `/#/beamline/xpcs`, an interactive station and the author's note. Only `dist/` is
published; the research dossiers remain available in the GitHub repository.

## Exploring the exhibit

| View | Content and controls |
| --- | --- |
| The APS | Orbit the facility, including the ring building, Lab/Office Modules, injectors and Long Beamline Building. Building footprints come from OpenStreetMap. Hover over a sector to see its beamlines, or select a feature beamline to enter it. |
| Feature beamlines | Follow the X-ray path through the front end, hutches, mirrors, monochromators, focusing optics, instruments and detectors. Models use documented component distances. The display includes beam colours, scattering cones, scale figures and a component map. |
| Beamline panel | Read the Overview, try the station in How it works, select components in Inside, and explore the Science examples. Specs & sources contains parameters, figures, references and unresolved details. |
| Guided tour | Visit the injectors, storage ring, undulators, each feature beamline and the Long Beamline Building. Open a fullscreen interactive station at a beamline stop and close it to continue at the same stop. Choose Step inside to explore the beamline, then Return to tour to resume. |
| The upgrade | Read the primer, compare the rings in By the numbers and follow the project timeline. Try stations on storage-ring magnets, brightness, undulators and coherence. |
| Other sectors | Read science descriptions, operators, status and techniques for the 35 beamline sectors. For the 15 enhanced sectors, descriptions explain the changes to existing beamlines. |
| Search | Find beamlines, components, techniques and sectors with `/` or `Ctrl+K`. |

Keyboard shortcuts:

| Key | Action |
| --- | --- |
| `Esc` | Return from a component to the beamline, then to the whole APS. |
| `[` and `]` | Select the previous or next component. |
| `F` | Frame the beamline. |
| `R` | Move the camera along the X-ray path. |
| `T` | Start or stop the tour. |
| `1` through `9` | Open a feature beamline. |
| `/` or `Ctrl+K` | Open search. |
| `?` | Open help. |

With the 3D view focused, arrow keys orbit the camera, `Shift` with arrow keys pans, and `+`, `−`, `PgUp` and `PgDn`
zoom. `Home` reframes the view. Dialogs contain keyboard focus, and panels use tab semantics. The app respects
`prefers-reduced-motion` by freezing animated beams, electron bunches and stations.

Deep links include `#/beamline/xpcs`, `#/beamline/3dmn/<component-id>`, `#/tour/3` and `#/sector/12`.

## The author's pages

Two Markdown files belong to the exhibit's author and are displayed as written:

- `src/author/welcome.md` contains the welcome dialog shown when the site opens at home, with choices to start the guided tour or explore freely. Direct links to beamlines, sectors and tour stops skip it. The author can leave it empty to disable the welcome.
- `src/author/note.md` contains the Author's note, accessible from the top bar, phone menu and welcome dialog.

The renderer supports headings, paragraphs, bold, italics, links, lists, quotes, fenced code blocks and dividers. It hides HTML comments.
Write links as `[link text](URL)`. In the welcome, `[author's note](#author-note)` opens the note dialog. Closing the note returns to the welcome. The welcome's choices enter the exhibit without opening another introduction.
AI agents and automated tools must never edit these files. See `AGENTS.md`.

The welcome shows a "Compiling Shaders" progress bar before enabling navigation. The app prepares the beamline
shaders for all three rendering settings, including the transparent building and shadow variants. High and
Balanced share scene shaders. Light uses separate output and shadow settings. Visitors can read the author's
note during compilation and return to the welcome. Buttons, the close control, backdrop clicks and Escape cannot
dismiss the welcome until compilation finishes. A failed preparation has a Retry button.

Preparation uses one temporary beamline model at a time. The app retains references to the compiled shader
materials and releases the temporary geometry. It still caches only two completed beamline models during
exploration. Direct links skip the welcome and prepare the selected model on entry.

## Writing exhibit text

Write for a curious non-expert while preserving the details that a beamline scientist would check. Begin with the
physical process or measured quantity. Explain the mechanism in plain words, defining technical terms where they appear.
Include useful numbers with units and the qualifications needed to interpret them. Distinguish design targets
from measurements, planned instruments from installed ones, and the beam modes used for quoted values.

Use complete sentences and concrete descriptions. State physical processes directly. Avoid instrument personification,
catchphrases, figurative descriptions of data, unnecessary
adverbs and filler. Use sentence-case headings, straight quotation marks, and periods or commas to separate ideas.
Preserve exact published source titles and scientific notation. Review component descriptions, help text, controls,
plot labels, comments and documentation under the same guidance.

Each field has one text for all readers. Tables contain component specifications and key parameters. Position
notes, detectors, sample environments, figure notes, unresolved questions, operators and techniques appear as fine
print. Scientific notation uses symbols such as µm, Å, °, × and 10⁻³. Existing data and copy tests reject ASCII
research notation and check that tour text fits its card.

## Content sources

The nine curated beamline dossiers are in `src/data/beamlines/<id>.json`. Their sources include the APS-U Final
Design Report of 2019, the Preliminary Design Report of 2017, APS pages and publications from MEDSI, SRI, Journal
of Synchrotron Radiation, Review of Scientific Instruments and APS news. Each component has a source reference.
Each dossier includes references, open questions and status information for 2026. Site geometry in
`src/data/site.json` uses OpenStreetMap footprints and documented ring parameters. See `scripts/build-site.py`.

Facility text and sector cards are generated from the fact-checked dossiers in `research/`. Exhibit wording is
stored in `scripts/exhibit-overrides/*.json`. This includes primer answers under `explainers`, timeline events,
number-card explanations, sector enhancement text, status descriptions and sector labels. The build scripts
apply the overrides and check typography. An override with a stale key fails the build. Edit the overrides and
rebuild rather than editing generated JSON:

```bash
python3 scripts/build-facility.py research/facility.json src/data/facility.json
python3 scripts/build-sectors.py  research/sectors.json  src/data/sectors.json
python3 scripts/build-site.py     research/site.json     src/data/site.json
```

The research dossiers in `research/` preserve verification records, open questions and references. The exhibit
beamline dossiers are curated from them. Tour and overview text are in `src/data/tour.ts` and `src/data/copy.ts`.

The brightness comparison is about 500 times the old APS, with gains of 100 to 1,000 depending on X-ray energy.
The design gain at 20 keV is 540. The user-mode electron source is about 12 × 8 µm, expressed as root-mean-square
widths. Keep these conditions with the numbers when editing.

This independent educational visualization is not an official APS or Argonne product. Hutches outside the feature
beamlines are schematic. Component models use realistic sizes and documented distances, with simplified shapes.

## Code map

| Path | Contents |
| --- | --- |
| `src/app/` | App controller, routing, camera transitions and preferences. |
| `src/scene/` | Renderer, camera controls, quality settings, picking, labels and materials. |
| `src/scene/site/` | Ring building, magnet lattice, Lab/Office Modules, injectors, trees and beamline overview. |
| `src/scene/beamline/` | Beamline scene construction, layout API, component models and static batching. |
| `src/beamlines/` | Geometry for each beamline, including branches and instruments. |
| `src/ui/` | Navigation, panels, overlays, search and the component map. |
| `src/ui/explainers/` | Interactive stations and shared controls. |
| `src/data/` | Exhibit dossiers, generated data, tour text and types. |
| `src/lib/` | DOM helpers, animation, Fourier transforms, random numbers and Poisson sampling. |
| `tests/` | Data, copy, router, renderer and physics unit tests. |
| `e2e/` | Playwright interaction tests. |
| `research/` | Fact-checked dossiers used to generate exhibit data. |
| `scripts/` | Data builders, image compression and development tools. |

The station test page at `/explainer.html?id=xpcs` accepts optional `color` and `bl` parameters, such as
`&color=%23ff8800&bl=xpcs`. To take a screenshot, run `node scripts/shot.mjs '#/beamline/xpcs' out.png`.
Append `?nobatch` to the URL to compare rendering without static batching.
