/**
 * Curated exhibit copy for the overview. Numbers are taken from the facility dossier (src/data/facility.json:
 * ring.before / ring.after / exhibitNumbers / brightness) — see tests/copy.test.ts.
 *
 * Brightness framing used everywhere in the exhibit: "about 500× (100–1000× depending on X-ray energy)".
 * Design anchors: ×540 at 20 keV for a 20-keV-optimised undulator (FDR Table 1.1); IPAC'21 design envelope
 * ≈ ×200 at 10 keV, ×700 at 20 keV, ×600–800 at 50–100 keV (coherent flux ≈ ×160 at 10 keV, ×600 at 20 keV).
 * Source size: round (user) mode 12.3 × 8.3 µm rms, flat mode 14.5 × 3.1 µm rms, vs 275 × 10 µm before.
 */
export const OVERVIEW_COPY = {
  title: 'A brighter light',
  plain:
    'The Advanced Photon Source is a 1.1-kilometre ring of electrons travelling at 99.9999996% of the speed of light. Magnets make them shed intense X-rays that scientists use to look inside batteries, catalysts, proteins and new materials. In 2023–24 the entire ring was replaced by a new design that squeezes the electron beam to about 10–30 micrometres across (thinner than a human hair), down from about half a millimetre wide, so its X-rays are about 500 times brighter (100 to 1,000 times, depending on the X-ray energy). Nine new “feature beamlines” were built to use that light.',
  expert:
    'The APS Upgrade replaced the 7 GeV double-bend-achromat ring with a 6 GeV, 200 mA hybrid seven-bend achromat (H7BA) with six reverse bends per sector: natural emittance ~42 pm·rad (28–44 pm·rad measured depending on coupling) versus ~3,100 pm·rad horizontally before. The source at an undulator shrank from ~275 × 10 µm rms to ~12 × 8 µm in the round-beam user mode (~14 × 3 µm in the low-coupling flat mode). Swap-out injection replaces depleted bunches every ~20 s and a superconducting bunch-lengthening cavity stretches bunches 2–4×. Brightness rises ~500× (design ×540 at 20 keV; 100–1000× across 10–100 keV).',
  stats: [
    {
      value: '6 GeV',
      label: 'electron energy (was 7)',
      note: 'Lower energy lowers emittance (∝ E²) and radiated power (∝ E⁴), making 200 mA affordable; the cost is ~27% lower photon energy per harmonic, made up for with shorter-period undulators and higher harmonics.',
    },
    { value: '42 pm·rad', label: 'emittance (was 3,100)', note: 'Natural emittance of the new lattice; measured 28–44 pm·rad depending on coupling.' },
    { value: '~500×', label: 'brighter X-rays', note: 'Design: ×540 at 20 keV, 100–1000× across 10–100 keV.' },
    { value: '1,321', label: 'magnets (was 1,097)', note: '33 per sector × 40, plus one extra corrector near injection; 200 pre-assembled modules.' },
  ] as { value: string; label: string; note?: string }[],
};
