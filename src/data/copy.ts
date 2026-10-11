/**
 * Curated exhibit copy for the overview. Numbers are taken from the facility dossier (src/data/facility.json:
 * ring.before / ring.after / exhibitNumbers / brightness). See tests/copy.test.ts.
 *
 * Brightness framing used everywhere in the exhibit: "about 500 times, with gains of 100 to 1,000 times depending on X-ray energy".
 * Design anchors: ×540 at 20 keV for a 20-keV-optimised undulator (FDR Table 1.1); IPAC'21 design envelope
 * ≈ ×200 at 10 keV, ×700 at 20 keV, ×600–800 at 50–100 keV (coherent flux ≈ ×160 at 10 keV, ×600 at 20 keV).
 * No measured APS-U brightness curve has been published, so brightness gains are always design values.
 * Source size: round (user) mode 12.3 × 8.3 µm rms, flat mode 14.5 × 3.1 µm rms, vs 275 × 10 µm before.
 *
 * `text` is the one overview text for every reader (≤ ~120 words): everyday lead, mechanism, then the telling numbers.
 * Stat notes are fine print: technical but readable, whole sentences.
 */
export const OVERVIEW_COPY = {
  title: 'X-rays from a smaller electron beam',
  text:
    "The Advanced Photon Source circulates electrons in a 1.1 km ring at 99.9999996% of light speed. Magnets bend their paths, causing them to emit X-rays that scientists use to study batteries, catalysts, proteins and materials. In 2023 and 2024 the storage ring was replaced. Each of its 40 sectors now uses seven main bends instead of two. Stronger focusing reduces the user-mode source to about 12 × 8 micrometres, compared with 275 × 10 µm before. These are root-mean-square widths, which describe the electron distribution. The X-rays are about 500 times brighter by design, with gains of 100 to 1,000 times depending on energy. Nine new feature beamlines use this smaller source.",
  stats: [
    {
      value: '6 GeV',
      label: 'electron energy, previously 7 GeV',
      note: "For a fixed lattice, emittance scales with electron energy squared, and radiated power with E⁴. Lower energy therefore reduces beam size and the power needed to maintain 200 mA. Each undulator harmonic has about 27% lower photon energy. Shorter-period undulators and higher harmonics compensate for this.",
    },
    {
      value: '42 pm·rad',
      label: 'natural emittance, previously 3,100 pm·rad',
      note: "Emittance is beam size multiplied by angular spread. It sets how small and parallel the X-ray source can be. The natural design value is 42 pm·rad. Measurements give 28 to 44 pm·rad, depending on how emittance is shared between the horizontal and vertical planes.",
    },
    {
      value: '~500×',
      label: 'brighter X-rays',
      note: "Design calculations give ×540 at 20 keV for an undulator optimized for that energy. Gains range from 100 to 1,000 times across 10 to 100 keV. No measured brightness curve has been published.",
    },
    { value: '1,321', label: 'magnets, previously 1,097', note: 'There are 33 magnets in each of 40 sectors and one extra corrector near injection. They were installed as 200 pre-assembled modules.' },
  ] as { value: string; label: string; note?: string }[],
};
