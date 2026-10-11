/**
 * Curated exhibit copy for the overview. Numbers are taken from the facility dossier (src/data/facility.json:
 * ring.before / ring.after / exhibitNumbers / brightness) — see tests/copy.test.ts.
 *
 * Brightness framing used everywhere in the exhibit: "about 500× (100–1000× depending on X-ray energy)".
 * Design anchors: ×540 at 20 keV for a 20-keV-optimised undulator (FDR Table 1.1); IPAC'21 design envelope
 * ≈ ×200 at 10 keV, ×700 at 20 keV, ×600–800 at 50–100 keV (coherent flux ≈ ×160 at 10 keV, ×600 at 20 keV).
 * No measured APS-U brightness curve has been published, so brightness gains are always design values.
 * Source size: round (user) mode 12.3 × 8.3 µm rms, flat mode 14.5 × 3.1 µm rms, vs 275 × 10 µm before.
 *
 * `text` is the one overview text for every reader (≤ ~120 words): everyday lead, mechanism, then the telling numbers.
 * Stat notes are fine print: technical but readable, whole sentences.
 */
export const OVERVIEW_COPY = {
  title: 'A brighter light',
  text:
    'The Advanced Photon Source is a 1.1 km ring of electrons travelling at 99.9999996% of the speed of light; magnets make them shed X-rays that scientists use to look inside batteries, catalysts, proteins and new materials. In 2023–24 the whole ring was replaced. Each of its 40 sectors now bends the electrons in seven gentle steps instead of two, squeezing the beam at the X-ray source to about 12 × 8 micrometres (µm; root-mean-square widths in user mode), down from 275 × 10 µm. Its X-rays are therefore about 500 times brighter, meaning more photons from a smaller spot into a narrower cone: 100 to 1,000 times, depending on energy, by design calculations. Nine new feature beamlines were built to use that light.',
  stats: [
    {
      value: '6 GeV',
      label: 'electron energy (was 7)',
      note: 'For a given lattice, emittance scales as the square of the electron energy E and radiated power as E⁴, so a lower energy gives a smaller beam and makes 200 mA affordable. The cost is about 27% lower photon energy per harmonic, made up for with shorter-period undulators and higher harmonics.',
    },
    {
      value: '42 pm·rad',
      label: 'emittance (was 3,100)',
      note: 'Emittance, the beam’s size × angular spread, sets how small and parallel the X-ray source can be. 42 pm·rad is the new lattice’s natural (design) value; 28–44 pm·rad has been measured, depending on how strongly the two planes are coupled.',
    },
    {
      value: '~500×',
      label: 'brighter X-rays',
      note: 'Design values: ×540 at 20 keV for an undulator optimized for 20 keV, and 100–1,000× across 10–100 keV. No measured brightness curve has been published.',
    },
    { value: '1,321', label: 'magnets (was 1,097)', note: '33 per sector × 40, plus one extra corrector near injection, installed as 200 pre-assembled modules.' },
  ] as { value: string; label: string; note?: string }[],
};
