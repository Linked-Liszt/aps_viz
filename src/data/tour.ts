import { FEATURE_META } from './meta';
import { BEAMLINES } from './beamlines';

export type TourShot =
  | { kind: 'overview' }
  | { kind: 'site'; target: 'injector' | 'ring' | 'undulator' | 'longBeamlines' }
  | { kind: 'beamline'; id: string };

export interface TourStep {
  kicker: string;
  title: string;
  plain: string;
  expert?: string;
  color?: string;
  shot: TourShot;
  beamline?: string;
}

/*
 * Facility numbers used below (src/data/facility.json and copy.ts): brightness ~500× (100–1000× depending on
 * X-ray energy; design ×540 at 20 keV); coherent flux ≈ ×160 at 10 keV, ≈ ×600 at 20 keV; source 12.3 × 8.3 µm rms
 * (round, user mode) or 14.5 × 3.1 µm (flat) vs 275 × 10 µm before; undulators have ~60–175 periods.
 */

const intro: TourStep[] = [
  {
    kicker: 'Welcome',
    title: 'A machine for seeing the invisible',
    plain:
      'This is the Advanced Photon Source at Argonne National Laboratory, near Chicago. Electrons race around the ring in the middle at 99.9999996% of the speed of light — 271,647 laps every second. Whenever magnets bend or wiggle them they throw off X-rays, and around the ring dozens of “beamlines” catch that light to study everything from batteries to viruses.',
    expert:
      'The APS is a 6 GeV, 200 mA storage-ring light source with 40 sectors: 35 host insertion-device and bending-magnet beamlines, while sectors 36–40 house RF cavities, injection and the bunch-lengthening cavity. The APS Upgrade (APS-U, $815M, complete in 2026) replaced the original ring with a multi-bend-achromat lattice, re-using the tunnel, injector and most beamline infrastructure.',
    shot: { kind: 'overview' },
  },
  {
    kicker: 'How it works · The injector',
    title: 'Linac and booster',
    plain:
      'Electrons start in a straight linear accelerator (linac), are gathered into tight bunches in a small accumulator ring, then ride the 368-metre booster ring, which ramps them up to their full energy of 6 billion electron-volts before they are shot into the big storage ring.',
    expert:
      'Thermionic RF gun → ~425–450 MeV linac → particle accumulator ring (PAR, 30.7 m) → booster synchrotron (368 m, ramped to 6 GeV) → booster-to-storage-ring transfer line. APS-U uses swap-out injection: about every 20 s the weakest bunch is kicked out to a dump and replaced in the same RF bucket by a fresh ~5–6 nC bunch, because the small dynamic aperture of the new lattice does not allow conventional accumulation.',
    shot: { kind: 'site', target: 'injector' },
  },
  {
    kicker: 'How it works · The new storage ring',
    title: 'Squeezing the beam',
    plain:
      'During a 352-day “dark period” every magnet in the 1.1-km ring was replaced — 200 pre-built modules, 1,321 magnets in all. Instead of bending the electrons with two big magnets per sector, each sector now uses seven gentler bends, six small reverse bends and very strong focusing magnets. The result: an electron beam only about 10–30 micrometres across (thinner than a human hair), down from about half a millimetre wide, so the X-rays it makes are far more concentrated — far “brighter”.',
    expert:
      'Each of the 40 sectors is a hybrid seven-bend achromat (H7BA): longitudinal-gradient dipoles M1/M2, transverse-gradient M3/M4, and reverse bends (offset quadrupoles Q4, Q5, Q8) that let the dispersion be shaped independently of the beta functions — lowering the natural emittance from 67 pm (same lattice without reverse bends) to ~42 pm at 6 GeV, versus ~3,100 pm·rad before. Quadrupole gradients reach ~80–100 T/m; the round vacuum chamber is 22 mm across, inside 26 mm magnet bores. In the round-beam user mode the source at an undulator is ~12 × 8 µm rms, versus ~275 × 10 µm before. (Magnet order in this model is schematic; counts are real.)',
    shot: { kind: 'site', target: 'ring' },
  },
  {
    kicker: 'How it works · Making X-rays',
    title: 'Undulators',
    plain:
      'In the straight sections between bends sit undulators — rows of alternating magnets that wiggle the electrons about a hundred times. The light from every wiggle adds up in step, giving an intense, laser-like beam of X-rays whose colour (energy) is tuned by opening or closing the magnet gap.',
    expert:
      'Planar hybrid permanent-magnet undulators (e.g. 21–33 mm periods; ~60–175 periods per device) emit harmonics at E_{n} ≈ n · 0.95 E²[GeV] / (λ_{u}[cm] (1 + K²/2)) keV; several sectors use canted pairs (two devices ~1 mrad apart feeding independent beamlines). The ~75× cut in horizontal emittance (3.1 nm → ~42 pm, within a few times λ/4π ≈ 10 pm at 10 keV) is what raises brightness and coherent flux: about ×160–200 at 10 keV and ×600–700 at 20 keV in the design envelope. The user-mode (round) source is ~12 × 8 µm rms; in the low-coupling (flat) mode the ~4 pm vertical emittance is diffraction-limited up to ~25 keV.',
    shot: { kind: 'site', target: 'undulator' },
  },
];

/**
 * Curated tour copy for the feature beamlines, distilled from each dossier's whatAPSUEnables (src/data/beamlines/<id>.json).
 * plain: visitor text; expert: specialist text. Keep both to 2–3 sentences and consistent with the facility framing above.
 */
const FEATURE_TOUR: Record<string, { plain: string; expert: string }> = {
  polar: {
    plain:
      'POLAR twists X-rays into left- and right-handed “corkscrews” to reveal which atoms are magnetic, even in samples squeezed between diamond tips. The upgraded source is about 20 times narrower side to side, so POLAR can focus its polarized beam to 0.1–0.4 micrometres, about 100 times smaller than the old 15–20 micrometre spot. Smaller spots allow smaller samples and higher pressures: 3 million atmospheres today, with about 6 million as the design goal.',
    expert:
      'The MBA source (σ_{x} 275 → 14.5 µm, σ′_{x} 11 → 2.9 µrad in brightness mode) lets fixed-figure KB optics reach 0.1–0.4 µm at 100–600 mm working distances with ~25–40% transmission, leaving room for cryostats, magnets and DACs. That opens XANES/XMCD/XMLD in DACs toward 3–6 Mbar, dichroic mapping at 100–400 nm and coherent dichroic imaging at ~10–50 nm, helped by a ~200× larger coherent fraction at 10 keV. Circular polarization still comes from crystal phase retarders (~2.7–14 keV); the superconducting SCAPE sources that would replace them are not yet installed (Sept 2026).',
  },
  xpcs: {
    plain:
      'XPCS watches the “twinkling” speckle of coherent X-rays to time how atoms, molecules and nanoparticles move. Every snapshot needs enough coherent photons, and the upgrade delivers about 100 to 500 times more of them. Because the fastest motion you can follow improves with the square of that gain, 8-ID can catch motion ten thousand times faster or more, study much fainter samples, and use higher-energy X-rays (up to 25 keV) that pass through thick sample cells.',
    expert:
      'The multispeckle g₂ signal-to-noise at fixed frame time grows linearly with coherent flux (∝ B λ²/4), so at fixed SNR the shortest accessible delay scales as B⁻²: a 10²–10³ coherent-flux gain buys 10⁴–10⁶ in time resolution or sensitivity. In practice: 10–20 µs multispeckle frames for weak scatterers, ~1 µs burst mode and a 100 ns design goal (48-bunch spacing 76.7 ns), coherent beams at 15–25 keV for in situ cells, and 0.3 µm coherent spots for wide-angle XPCS. The cost is dose and data: up to ~20 PB a year, versus ~0.1 PB before.',
  },
  cssi: {
    plain:
      'CSSI skims a coherent X-ray beam across chips and thin films and records the speckle in a 20-metre vacuum tube to image their buried nanostructures. On the old APS one usable pattern from an oversized gold test target took a few hours; the upgraded beam is about 100 times more coherent, so real samples can be measured fast enough to follow them as they change. For speckle “movies” the gain counts twice: in principle up to 10,000 times faster, in practice limited by the camera to about a thousandth of a second.',
    expert:
      'Lower emittance raises the coherent fraction at 10 keV from ~0.05% to ~2.6% (round beam) or ~6% (flat beam) and the horizontal coherence length at 30 m from ~2 µm to ~40–50 µm; with the U21/U25 revolver (~1–2 × 10²² ph/s/mm²/mrad²/0.1% BW near 9–11 keV) coherent flux rises ~100–200×. Coherence-preserving horizontal-deflection optics, focusing to ~0.5 µm and a 2.9–21.8 m in-vacuum flight path let the speckle be oversampled even at 25 keV. For grazing-incidence XPCS the 1/B² scaling of the shortest delay is capped in practice by the ~1–2.5 ms detector frame time.',
  },
  isn: {
    plain:
      'ISN is a 220-metre X-ray microscope that watches batteries, catalysts and solar cells at work, in spots just tens of nanometres wide. A nanoprobe can use only the coherent part of the beam for its smallest spot and throws the rest away at a pair of slits; the old 275-micrometre-wide source left very little, while the upgraded ring squeezes it to about 12–15 micrometres. That lets ISN aim for a 20-nanometre spot with enough X-rays to scan large samples quickly, even at high energies that pass through cell windows, water and gas.',
    expert:
      'Diffraction-limited KB focusing accepts about one transverse coherent mode per plane (BDAs closed to Δ ≈ 0.44 λz/A), so the focused flux scales with the source’s coherent flux. With ε_{x} ≈ 30–42 pm·rad, within ~3–10× of λ/4π (9.9 pm at 10 keV, 3.9 pm at 25 keV), the design gives 3.4 × 10¹¹ ph/s coherent into 16 × 16 nm² at 25 keV and 3.5 × 10¹² ph/s into 39 × 39 nm² at 10 keV. The 220 m geometry and long KB mirrors give a 61 mm working distance for in situ cells, and every upstream optic sits before the BDAs, which filter out its wavefront errors and motions.',
  },
  hexm: {
    plain:
      'HEXM is a 180-metre microscope that uses very high-energy X-rays to see deep inside solid metal, from whole parts down to single crystal grains. The upgraded source is about 19 times narrower side to side, so lenses 180 metres away can still focus to a spot about 200 nanometres high, with room left for furnaces and load frames, or spread the beam over several millimetres to image a whole sample. Far more of the light is now coherent, too, enough for lens-free imaging of the strain inside a single buried grain.',
    expert:
      'ε_{x} falls from 3,113 to 42 pm·rad and, in flat-beam mode, the vertical emittance from ~40 to ~4 pm; at 35–120 keV the intrinsic photon divergence is small, so the electron beam sets the photon phase space in both planes and both reductions pay off. Design values: 209 nm vertical FWHM at 180 m with an f = 2 m CRL at 70 keV (77 nm with an f = 1 m kinoform), refractive expansion to 3–4 mm for nf-HEDM and µCT and ~500× the coherent flux of pre-upgrade 1-ID at 40 keV for BCDI on 10–20 µm grains. The planned 16.5 mm superconducting undulator pair is not yet installed; 20-ID runs on interim 2.1/2.5 cm permanent-magnet devices.',
  },
  chex: {
    plain:
      'CHEX splits laser-like, high-energy X-rays four ways to watch new materials grow atom by atom inside working reactors. On the old APS only about one high-energy X-ray in ten thousand was coherent, so a speckle measurement on a growing gallium-nitride crystal needed an unfiltered “pink” beam and 10-second exposures. The upgrade makes the coherent part of the beam at 20–25 keV a few hundred times stronger, turning such measurements from a stunt into routine work, fast enough to follow a film as it grows.',
    expert:
      'Coherent flux scales as B·(λ/2)², so the 15–60 keV range needed to see through quartz, steel and liquid cells was coherence-starved on the 3.1 nm·rad ring; APS-U raises coherent flux at 20 keV by ~540× (design, for a 20-keV-optimised undulator). The pre-upgrade benchmark (12-ID-D, 25.75 keV) needed pink beam (ΔE/E = 1.3 × 10⁻²) for 1.4 × 10¹² ph/s and 10 s frames; now transmissive diamond monochromators split off harmonics so four long in situ experiments run at once. The sector currently runs on interim 2.8/3.0 cm permanent-magnet undulators instead of the planned 18.5 mm superconducting pair, so high-energy flux is below design.',
  },
  ptychoprobe: {
    plain:
      'PtychoProbe is an X-ray microscope chasing 5-nanometre beams to reveal which elements sit where inside chips, batteries and cells. Before the upgrade, nanoprobes had to pass the beam through a tiny pinhole and throw most of it away; the new source is about 20 times narrower side to side, so far more of the light is coherent and can be focused to the smallest possible spot. The design goal is a focused beam about a thousand times more concentrated and scans up to a thousand times faster, so whole devices can be imaged at nanometre detail.',
    expert:
      'A scanning nanoprobe is brightness-limited: diffraction-limited focusing needs a quasi-point source, so before the upgrade the secondary-source aperture had to be closed down (2-ID-D used ~80 µm slits, discarding ~90% of the flux). With σ_{x} 275 → 14.5 µm the coherent fraction at 8 keV (4.8 m undulator) rises from ~0.08% to ~12% and coherent flux by >100×, so the aperture can open to the full coherence length and still pass ~5 × 10¹² coherent ph/s at 10 keV. Projected focused flux density rises from ~10⁵–10⁶ to ~10⁸–10⁹ ph/s/0.01% BW/nm² (50 nm → 5 nm spots), which is why the beamline is built around fast photon-counting detectors, fly scanning and HPC reconstruction.',
  },
  '3dmn': {
    plain:
      '3DMN uses a “rainbow” (Laue) X-ray beam as fine as a virus to map how the crystals inside metals and chips tilt and stretch, in 3D. The focused spot is a shrunken image of the source, and the upgraded source is about 19 times narrower side to side and hundreds of times brighter, so new, more precise mirrors are designed to reach spots of about 100 nanometres, and 40 at the nano station, with far more X-rays. That lets 3DMN look inside the tangled defect walls that make metals strong and follow materials while they are heated, loaded or switched.',
    expert:
      'KB optics image the source, so the 280 → 14.7 µm rms horizontal source (vertical 10 → 3.2 µm) shrinks the geometric image ~19× horizontally, and newly figured KBs can be fully illuminated instead of apertured to ~60 × 60 µm² (~9× more flux). Design ray traces give ~100 nm (micro) and ~40 nm (nano) foci with ~10¹⁴ ph/s pink and ~10¹¹–10¹² ph/s monochromatic beam; the 2017 design report’s budget (source × KB acceptance × coded-aperture depth scans × photon-counting detectors) reaches ~900× for most experiments and up to ~45,000× for some. The horizontal coherent fraction at 14 keV rises from ~0.2% to ~9%, which makes Bragg CDI of grains pre-oriented by Laue practical at the micro station.',
  },
  atomic: {
    plain:
      'ATOMIC is a lens-free X-ray microscope that rebuilds single nanocrystals in 3D and reveals the strain hidden inside them. Coherent imaging works only with the part of the beam whose waves march in step, a tiny fraction on the old APS; the new source is about 19 times narrower side to side, so ATOMIC is designed to pour hundreds of times more useful light into a spot only 50 nanometres wide. That is expected to cut some 3D strain pictures from several minutes to tens of seconds, fast enough to follow batteries and catalysts while they work.',
    expert:
      'The horizontal source shrinks from 280 to 14.7 µm rms, raising the coherent fraction at ~10 keV from ~0.04% to ~5% (estimate); the design coherent-flux gain is ~540× at 20 keV for a 20-keV-optimised undulator, and smaller at ATOMIC’s ~9 keV (~125× in coherent fraction, times 2–3× more central-cone flux). Slit-based coherent-mode selection and a zoom KB (50 nm–2 µm) put nearly all of the coherent flux on the crystal: 3.1 × 10¹² ph/s/0.1% BW in 50 nm at 8.7 keV (design). The design report expects sub-10-nm operando imaging in tens of seconds; heat load (~8 mW in a 50 nm spot), radiation damage and a ~400× jump in data volume become first-order design problems.',
  },
};

const features: TourStep[] = FEATURE_META.map((m, i) => {
  const b = BEAMLINES[m.id];
  const curated = FEATURE_TOUR[m.id];
  return {
    kicker: `Feature beamline ${i + 1} of ${FEATURE_META.length} · ${m.sectorNumber}-ID`,
    title: `${b?.acronym ?? m.id.toUpperCase()} — ${m.displayName}`,
    plain: curated?.plain ?? (b ? `${b.tagline} ${firstSentences(b.whatAPSUEnables?.plain ?? b.plainSummary, 2)}` : m.short),
    expert: curated?.expert ?? (b ? firstSentences(b.whatAPSUEnables?.expert ?? b.expertSummary, 3) : undefined),
    color: m.color,
    shot: { kind: 'beamline', id: m.id },
    beamline: m.id,
  };
});

const outro: TourStep[] = [
  {
    kicker: 'Long beamlines',
    title: 'Reaching beyond the ring',
    plain:
      'Two beamlines — the In Situ Nanoprobe and the High-Energy X-ray Microscope — are so long they leave the main building, running through corridors to the Long Beamline Building opened in 2022. The extra distance lets their optics demagnify the source into extremely small spots and leaves room for big in situ equipment.',
    shot: { kind: 'site', target: 'longBeamlines' },
  },
  {
    kicker: 'Your turn',
    title: 'Explore on your own',
    plain:
      'Click any glowing beamline to step inside, pick components to learn what they do, and try the interactive station on each one. Use the Visitor / Specialist switch for the full technical detail.',
    shot: { kind: 'overview' },
  },
];

export const TOUR: TourStep[] = [...intro, ...features, ...outro];

/** Abbreviations whose trailing period never ends a sentence. */
const ABBREVIATION = /\b(?:e\.g|i\.e|et al|cf|vs|approx|ca|Fig|Figs|Eq|Eqs|Ref|Refs|Sec|Tab|Dr|Prof)\.$/;
/** Inline research citations such as "(r12)" or "(r3, r7b)". */
const CITATION = /\s*\((?:r\d+[a-z]?(?:[,;]\s*)?)+\)/g;

/**
 * Fallback for beamlines without curated tour copy: the first `n` sentences of `s`.
 * A sentence ends only at . ! or ? (plus any closing quotes) that is followed by whitespace and a capital letter,
 * or by the end of the text — never between digits (3.6), after an abbreviation (e.g., i.e., et al., Fig., Eq.)
 * or inside an open parenthesis/bracket.
 */
export function firstSentences(s: string, n: number): string {
  const text = s.replace(CITATION, '').trim();
  let depth = 0;
  let count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '(' || c === '[') depth++;
    else if ((c === ')' || c === ']') && depth > 0) depth--;
    else if ((c === '.' || c === '!' || c === '?') && depth === 0) {
      let j = i + 1;
      while (j < text.length && /["'’”]/.test(text[j])) j++;
      const atEnd = j >= text.length;
      if (!atEnd && !/^\s+["'‘“(]?[A-Z]/.test(text.slice(j))) continue;
      if (c === '.' && ABBREVIATION.test(text.slice(Math.max(0, i - 8), i + 1))) continue;
      count++;
      if (count >= n || atEnd) return text.slice(0, j).trim();
      i = j - 1;
    }
  }
  return text;
}
