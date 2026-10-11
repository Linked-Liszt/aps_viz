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
    title: 'The APS storage ring',
    text:
      "This is the Advanced Photon Source, or APS, at Argonne National Laboratory near Chicago. Electrons circulate in its 1.1 km ring at 99.9999996% of light speed, making 271,647 laps each second. They emit X-rays where magnets bend their paths. Beamlines in 35 of the 40 sectors carry these X-rays to experiments on materials and biological samples. An $815 million upgrade, completed in 2026, replaced the storage ring to produce a smaller, brighter source.",
    shot: { kind: 'overview' },
  },
  {
    kicker: 'How it works · The injector',
    title: 'Linac and booster',
    text:
      "Electrons start in a linear accelerator, or linac. A 30.7 m accumulator ring gathers them into bunches, and a 368 m booster raises their energy to 6 billion electron-volts, or 6 GeV. Strong focusing leaves a stable region only about ±1.5 mm wide in the storage ring, too small to add electrons to stored bunches. About every 20 seconds, kicker magnets therefore replace the most depleted bunch with a fresh one from the booster.",
    shot: { kind: 'site', target: 'injector' },
  },
  {
    kicker: 'How it works · The new storage ring',
    title: 'A smaller electron beam',
    text:
      "During a 352-day shutdown, every magnet in the 1.1 km ring was replaced with 200 pre-built modules containing 1,321 magnets. Each of 40 sectors now uses seven main bends instead of two, plus six small reverse bends and stronger focusing. Horizontal emittance, beam size multiplied by angular spread, fell about 75-fold from 3,100 to 42 picometre-radians. At an undulator, the round-mode rms source widths are about 12 × 8 µm, compared with 275 × 10 µm before. Rms describes the electron distribution width.",
    shot: { kind: 'site', target: 'ring' },
  },
  {
    kicker: 'How it works · Making X-rays',
    title: 'Undulators',
    text:
      "Undulators are rows of alternating magnets in the straight sections. They deflect electrons from side to side about 60 to 175 times per pass. Radiation from these deflections reinforces at particular wavelengths, producing a narrow beam whose energy is tuned by the magnet gap. The smaller electron source gives about 500 times greater design brightness, with gains of 100 to 1,000 times depending on energy. One design study predicts coherent flux gains of about 160 times at 10 keV and 600 times at 20 keV.",
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
    "POLAR uses circularly polarized X-rays to measure each element's magnetization, including in samples between diamond anvils. Circular polarization means the electric-field direction rotates as the wave travels. The upgraded source is about 19 times narrower horizontally, allowing mirrors to focus the beam to 100 to 400 nm, compared with about 15 µm before. Smaller samples can reach higher pressures. Experiments have reached 3 megabars, about 3 million atmospheres; the design goal is about 6 megabars.",
  xpcs:
    "X-ray photon correlation spectroscopy, or XPCS, measures motion from changes in coherent speckle patterns. The predicted coherent flux gain is about 250 to 500 times at 20 keV. When photon counts limit a measurement, frame time scales inversely with coherent flux squared. A 100-fold flux gain can give 10,000-fold shorter frames at equal quality and acquisition time, with contrast and pixel count fixed. Detector speed and dose can limit this gain. Coherent beams up to 25 keV also penetrate buried samples.",
  cssi:
    "CSSI directs coherent X-rays across thin films at a fraction of a degree and records speckle through a 20 m vacuum tube. The patterns allow 3D reconstruction of buried nanostructures. Before the upgrade, one usable pattern from an oversized gold test object took hours. A roughly 100 to 200-fold coherent flux gain allows measurements during sample changes. Speckle movies can improve up to 10,000-fold in principle because frame time depends on flux squared, but the camera limits frames to milliseconds.",
  isn:
    "ISN is a 220 m X-ray microscope for studying devices during operation. Slits select coherent light for the smallest focus and discard the rest. The old 275 µm source provided little usable light; APS-U reduces that width to about 15 µm. The target spot is 20 nm, while first measurements report 25 to 30 nm. The planned working space for sample cells is 61 mm. X-rays up to 30 keV pass through windows, water and gas.",
  hexm:
    "HEXM uses 35 to 120 keV X-rays to study metal samples about 180 m from the source. APS-U is about 19 times narrower horizontally and also narrower vertically in brightness mode. Lenses 2 m before the sample are designed for a 200 nm vertical spot, leaving room for furnaces and load frames. A broader beam images whole samples. The design estimates about 500 times the coherent flux of old 1-ID at 40 keV, assuming superconducting undulators that are not yet installed.",
  chex:
    "At CHEX, coherent X-rays are used to study material growth inside reactors, with up to four experiments supplied at once. At old APS, about one 25 keV photon in ten thousand was coherent. Gallium nitride growth movies used a broader-energy pink beam without a monochromator and 10-second frames. For undulators tuned to 20 keV, the design predicts about 540 times more coherent flux at that energy. CHEX uses interim undulators, and no measured flux has been published.",
  ptychoprobe:
    "The target focus at PtychoProbe is 5 nm for element maps inside chips, batteries and cells. Before the upgrade, nanoprobes selected coherent light with slits; 2-ID-D discarded about 90% of its photons. The new source is about 19 times narrower horizontally. At 8 keV, its coherent share increases from about 0.08% to 12%. The design predicts about 1,000 times more photons per square nanometre at the focus. The listed focus in 2026 is 20 nm.",
  '3dmn':
    "3DMN uses many X-ray energies together, a Laue beam, to map crystal-grain orientation and strain in 3D. Focusing mirrors form a reduced image of the source, which is about 19 times narrower horizontally after the upgrade. New mirrors are designed for spots of about 100 nm, or 40 nm at the nano station, compared with 300 to 500 nm before. The design estimates about 900 times faster measurements for most experiments. Planned detector purchases were removed from the project.",
  atomic:
    "ATOMIC reconstructs 3D strain inside single nanocrystals from coherent diffraction patterns. At 10 keV, about 0.04% of old APS light was coherent, compared with an estimated 5% at APS-U. Slits and bendable zoom mirrors are designed to focus nearly all this coherent light onto each crystal. The planned spot ranges from 2 µm to 50 nm. Some 3D strain measurements are expected to take tens of seconds rather than minutes.",
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
    title: `${b?.acronym ?? m.id.toUpperCase()}. ${m.displayName}`,
    text: FEATURE_TOUR[m.id] ?? (b ? `${b.tagline} ${firstSentences(dossierText(b), 2)}`.trim() : m.short),
    color: m.color,
    shot: { kind: 'beamline', id: m.id },
    beamline: m.id,
  };
});

const outro: TourStep[] = [
  {
    kicker: 'Long beamlines',
    title: 'The Long Beamline Building',
    text:
      "ISN and HEXM extend beyond the main ring building to the Long Beamline Building, opened in 2022. Their lengths are about 220 m and 180 m respectively. A long source-to-optic distance gives a strongly reduced source image with focusing optics placed well back from the sample. ISN provides 61 mm of working space, and HEXM lenses sit 2 m before the sample.",
    shot: { kind: 'site', target: 'longBeamlines' },
  },
  {
    kicker: 'Your turn',
    title: 'Explore on your own',
    text:
      "Select a glowing beamline to enter its 3D model. Choose a component to read what it does, or try the interactive station. Each of the nine feature beamlines has a Specs & sources tab with parameters, references and questions that remain unresolved.",
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
 * or by the end of the text. It never ends between digits (3.6), after an abbreviation (e.g., i.e., et al., Fig., Eq.)
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
