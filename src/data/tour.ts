import { FEATURE_META } from './meta';
import { BEAMLINES } from './beamlines';

export type TourShot =
  | { kind: 'overview' }
  | { kind: 'site'; target: 'injector' | 'ring' | 'undulator' | 'longBeamlines' }
  | { kind: 'beamline'; id: string };

export interface TourStep {
  kicker: string;
  title: string;
  /** One text for every reader: an everyday lead, the mechanism, then a precise number or caveat (2–4 sentences, ≤ ~85 words). */
  text: string;
  color?: string;
  shot: TourShot;
  beamline?: string;
}

/*
 * Facility numbers used below (src/data/facility.json and copy.ts): brightness ~500× (100–1000× depending on
 * X-ray energy; design ×540 at 20 keV); coherent flux ≈ ×160 at 10 keV, ≈ ×600 at 20 keV; emittance ~3,100 → 42 pm·rad
 * (~75×); source 12.3 × 8.3 µm rms (round, user mode) or 14.5 × 3.1 µm (flat) vs 275 × 10 µm before; undulators have
 * ~60–175 periods; swap-out about every 20 s (dynamic aperture ~±1.5 mm).
 */

const intro: TourStep[] = [
  {
    kicker: 'Welcome',
    title: 'A machine for seeing the invisible',
    text:
      'This is the Advanced Photon Source (APS) at Argonne National Laboratory, near Chicago. Electrons race around its 1.1 km ring at 99.9999996% of the speed of light, 271,647 laps every second, and wherever magnets bend or wiggle them they give off X-rays. Beamlines around the ring catch that light to study everything from batteries to viruses; 35 of the ring’s 40 sectors host them. An $815 million upgrade, completed in 2026, rebuilt the ring for a far brighter beam.',
    shot: { kind: 'overview' },
  },
  {
    kicker: 'How it works · The injector',
    title: 'Linac and booster',
    text:
      'Electrons start in a linear accelerator (linac), are gathered into tight bunches in a 30.7 m accumulator ring, then ride the 368 m booster, which ramps them to their full energy of 6 billion electron-volts (6 GeV). The new ring’s strong focusing leaves too little room, about ±1.5 mm, to stack new electrons onto stored bunches, so it swaps instead: about every 20 seconds the most depleted bunch is kicked out to a dump and replaced in the same slot by a fresh one.',
    shot: { kind: 'site', target: 'injector' },
  },
  {
    kicker: 'How it works · The new storage ring',
    title: 'Squeezing the beam',
    text:
      'During a 352-day dark period every magnet in the 1.1 km ring was replaced: 200 pre-built modules, 1,321 magnets in all. Each of the 40 sectors once bent the electrons with two large magnets; now it uses seven gentler bends, six small reverse bends and far stronger focusing. That cut the beam’s horizontal emittance, size × angular spread, about 75-fold, from 3,100 to 42 picometre-radians: at an undulator the round-mode beam’s root-mean-square widths are now about 12 × 8 micrometres (µm) instead of 275 × 10 µm, thinner than a hair.',
    shot: { kind: 'site', target: 'ring' },
  },
  {
    kicker: 'How it works · Making X-rays',
    title: 'Undulators',
    text:
      'In the straight sections sit undulators: rows of alternating magnets that wiggle the electrons from side to side, typically 60 to 175 times per pass. Light from every wiggle adds up in step, so the X-rays emerge as a narrow beam concentrated at a few energies, tuned by the magnet gap. With the narrower electron beam, design brightness rises about 500 times (100–1,000 times, depending on energy); one design study gives coherent flux, the in-step light, about 160 times at 10 keV and 600 times at 20 keV.',
    shot: { kind: 'site', target: 'undulator' },
  },
];

/**
 * Curated tour copy for the feature beamlines, distilled from each dossier's summary and whatAPSUEnables.text
 * (src/data/beamlines/<id>.json). One text per stop for every reader: 2–4 sentences, ≤ ~85 words, ending with a precise
 * number or caveat, and consistent with the facility framing above.
 */
const FEATURE_TOUR: Record<string, string> = {
  polar:
    'POLAR twists X-rays into left- and right-handed corkscrews, circular polarization, to reveal how strongly each element in a material is magnetized, even in samples squeezed between diamond tips. The upgraded source is about 19 times narrower horizontally, so POLAR’s mirrors can focus the polarized beam to 100–400 nm, against about 15 µm before. Smaller spots allow smaller samples and higher pressures: 3 megabars (about 3 million atmospheres) today, with about 6 megabars as the design goal.',
  xpcs:
    'X-ray photon correlation spectroscopy (XPCS) times motion by watching coherent speckle flicker as atoms, molecules or nanoparticles shift. The design gives roughly 250–500 times more coherent photons at 20 keV. When photon counts set the limit, frame time falls as one divided by coherent flux squared: a 100-fold gain can give 10,000-fold shorter frames at equal quality and acquisition time, with contrast and pixel count fixed. Detector speed and dose can limit the gain; higher-energy coherent beams also reach 25 keV for fainter or buried samples.',
  cssi:
    'CSSI skims a coherent X-ray beam across chips and thin films at a fraction of a degree and records the speckle in a 20-metre vacuum tube, imaging buried nanostructures in 3D. Before the upgrade one usable pattern from an oversized gold test object took a few hours; roughly 100–200 times more coherent flux now lets real samples be measured as they change. For speckle movies the gain counts twice, up to 10,000 times faster in principle, though the camera’s millisecond frame time sets the practical limit.',
  isn:
    'ISN is a 220-metre X-ray microscope that watches batteries, catalysts and solar cells at work. A nanoprobe makes its smallest spot only from coherent light and discards the rest at a pair of slits; the old 275 µm-wide source left little, while the upgraded ring squeezes it to about 15 µm. That lets ISN aim for a 20 nm spot (first measurements report 25–30 nm) with 61 mm of working space for cells, at energies up to 30 keV that pass through windows, water and gas.',
  hexm:
    'HEXM is a 180-metre microscope whose 35–120 keV X-rays see deep inside metal. The upgraded source is about 19 times narrower horizontally and, in brightness mode, thinner vertically, so lenses 2 m before the sample can focus to a spot designed to be about 200 nm tall, leaving room for furnaces and load frames, or spread the beam over millimetres to image a whole sample. The design projects about 500 times the coherent flux of the old 1-ID at 40 keV, assuming superconducting undulators not yet installed.',
  chex:
    'CHEX uses coherent high-energy X-rays to watch materials grow atom by atom inside working reactors, splitting its light among up to four experiments at once. Before the upgrade roughly one 25 keV X-ray in ten thousand was coherent, so filming gallium nitride growth needed a ‘pink’ beam, with no monochromator, and 10-second frames. With undulators tuned to 20 keV the design gives about 540 times more coherent flux there, enough to follow a film as it grows; CHEX still runs on interim undulators, with no measured flux published.',
  ptychoprobe:
    'PtychoProbe is an X-ray microscope aiming for a 5 nm beam to reveal which elements sit where inside chips, batteries and cells. Before the upgrade, nanoprobes made their light coherent by closing slits and discarding photons, about 90% of them at 2-ID-D. The new source is about 19 times narrower horizontally, so at 8 keV the coherent share of the light rises from about 0.08% to 12%. The design projects about 1,000 times more photons per square nanometre in the focus; the focus listed in 2026 is 20 nm.',
  '3dmn':
    '3DMN focuses a ‘rainbow’ of X-ray energies, a Laue beam, to map in 3D how the crystal grains inside metals and chips tilt and stretch. A focusing mirror forms a shrunken image of the source, and the upgraded source is about 19 times narrower horizontally, so sharper new mirrors are designed for spots of about 100 nm, and 40 nm at the nano station, down from 300–500 nm. The design estimates about 900 times faster measurements for most experiments, though detector purchases were cut from the project.',
  atomic:
    'ATOMIC is a lens-free X-ray microscope that rebuilds single nanocrystals in 3D and reveals the strain hidden inside them. Coherent imaging can use only the in-step part of the beam: about 0.04% of the light at 10 keV on the old APS, an estimated 5% on the new ring. Slits and bendable zoom mirrors are designed to put nearly all of it on each crystal, in spots from 2 µm down to 50 nm, which should cut some 3D strain images from minutes to tens of seconds.',
};

/** A dossier's unified text for the tour fallback: whatAPSUEnables.text, else summary (src/data/beamlines/<id>.json). */
function dossierText(b: object): string {
  const d = b as { summary?: string; whatAPSUEnables?: { text?: string } };
  return d.whatAPSUEnables?.text ?? d.summary ?? '';
}

const features: TourStep[] = FEATURE_META.map((m, i) => {
  const b = BEAMLINES[m.id];
  return {
    kicker: `Feature beamline ${i + 1} of ${FEATURE_META.length} · ${m.sectorNumber}-ID`,
    title: `${b?.acronym ?? m.id.toUpperCase()} — ${m.displayName}`,
    text: FEATURE_TOUR[m.id] ?? (b ? `${b.tagline} ${firstSentences(dossierText(b), 2)}`.trim() : m.short),
    color: m.color,
    shot: { kind: 'beamline', id: m.id },
    beamline: m.id,
  };
});

const outro: TourStep[] = [
  {
    kicker: 'Long beamlines',
    title: 'Reaching beyond the ring',
    text:
      'Two beamlines, the In Situ Nanoprobe (ISN, about 220 m) and the High-Energy X-ray Microscope (HEXM, about 180 m), are so long that they leave the main building and run to the Long Beamline Building, opened in 2022. Placing the focusing optics far from the source lets them shrink its image strongly while standing well back from the sample: ISN keeps 61 mm of working space, and HEXM’s lenses sit 2 m before it.',
    shot: { kind: 'site', target: 'longBeamlines' },
  },
  {
    kicker: 'Your turn',
    title: 'Explore on your own',
    text:
      'Click any glowing beamline to step inside, pick components to learn what they do, and try the interactive station on each of the nine feature beamlines. Each beamline’s Specs & sources tab lists its key numbers, where they come from and the questions that remain open.',
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
