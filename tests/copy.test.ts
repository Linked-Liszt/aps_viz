import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OVERVIEW_COPY } from '../src/data/copy';
import { TOUR, firstSentences, type TourStep } from '../src/data/tour';
import { FEATURE_META } from '../src/data/meta';
import { BEAMLINES } from '../src/data/beamlines';

const fac = JSON.parse(readFileSync(join(__dirname, '../src/data/facility.json'), 'utf8'));
const sectors = JSON.parse(readFileSync(join(__dirname, '../src/data/sectors.json'), 'utf8'));
const after = fac.ring.after;
const before = fac.ring.before;

describe('overview numbers match the facility dossier', () => {
  it('energy, emittance, magnets', () => {
    expect(after.beamEnergy.value).toBe(6);
    expect(before.beamEnergy.value).toBe(7);
    expect(Math.round(after.naturalEmittance.value)).toBeGreaterThanOrEqual(41);
    expect(Math.round(after.naturalEmittance.value)).toBeLessThanOrEqual(42);
    expect(before.horizontalEmittance.value).toBe(3100);
    expect(fac.lattice.magnetsTotal.value).toBe(1321);
    expect(before.magnets.value).toBe(1097);
    const stats = OVERVIEW_COPY.stats.map((s) => `${s.value} ${s.label}`).join(' | ');
    expect(stats).toContain('6 GeV');
    expect(stats).toContain('42 pm');
    expect(stats).toContain('3,100');
    expect(stats).toContain('1,321');
    expect(stats).toContain('1,097');
  });
  it('brightness headline is sourced', () => {
    const s = JSON.stringify(fac.brightness.statements);
    expect(s).toMatch(/500 times brighter/);
  });
  it('the overview text quotes the dossier’s source sizes and brightness framing', () => {
    const t = OVERVIEW_COPY.text;
    expect(t).toContain(`${before.horizontalBeamSizeAtID.value} × ${before.verticalBeamSizeAtID.value} µm`);
    expect(t).toContain(`${Math.round(after.horizontalBeamSizeAtID_round.value)} × ${Math.round(after.verticalBeamSizeAtID_round.value)}`);
    expect(t).toMatch(/about 500 times brighter/);
    expect(t).toMatch(/100 to 1,000 times/);
  });
});

// ------------------------------------------------------------------ guided tour text

/** Visible text of a tour stop (as the tour card renders it). */
const tourText = (s: TourStep) => s.text;
/** The tour card has room for about four sentences; the copy aims at ≤ ~85 words. */
const TOUR_MAX_WORDS = 95;

/** Starts like a sentence: a capital, a digit, a Greek symbol (ε_{x} falls …) or an opening quote/parenthesis. */
const SENTENCE_START = /^(?:[\p{Lu}\d“"‘(]|\p{Script=Greek})/u;
/** Ends like a sentence: . ! ? or ) plus any closing quotes. */
const SENTENCE_END = /[.!?)][”"’']*$/;
/** A cut inside an abbreviation ("… e.g." / "… et al") rather than at a sentence end. */
const FRAGMENT_END = /\b(?:e\.g|i\.e|et al|cf|vs|approx|ca|Fig|Figs|Eq|Eqs|Ref|Refs|Sec)\.?$/;
/** Research notation that must not reach visitors (ASCII units, arrows, roots, e-notation, caret powers). */
const ASCII_NOTATION: [string, RegExp][] = [
  ['um for µm', /\d\s?um\b/],
  ['urad for µrad', /\d\s?urad\b/],
  ['-> arrow', /\s->\s/],
  ['sqrt', /\bsqrt/],
  ['deg for °', /\d\s?deg\b/],
  ['e-notation', /\d(?:\.\d+)?e[-+]?\d+/],
  ['bare caret power', /\^(?!\{)/],
  ['+/- for ±', /\+\/-/],
  ['ASCII * for × or ·', /\s\*\s/],
  ['ASCII x between numbers', /\d\s+x\s+\d/],
  ['mm2/nm2 for mm²/nm²', /\b(?:mm|nm|µm|um)2\b/],
  ['spelled-out Greek', /\b(?:sigma|theta|lambda)\b/],
];

function balanced(s: string): boolean {
  let paren = 0;
  let bracket = 0;
  for (const c of s) {
    if (c === '(') paren++;
    else if (c === ')') paren--;
    else if (c === '[') bracket++;
    else if (c === ']') bracket--;
    if (paren < 0 || bracket < 0) return false;
  }
  return paren === 0 && bracket === 0;
}

/** Problems with a piece of prose that is shown as whole sentences. */
function proseProblems(t: string): string[] {
  const out: string[] = [];
  if (t.trim().length < 20) out.push('empty or too short');
  if (t !== t.trim()) out.push('leading/trailing whitespace');
  if (!SENTENCE_START.test(t)) out.push(`starts mid-sentence: "${t.slice(0, 20)}"`);
  if (!SENTENCE_END.test(t)) out.push(`does not end a sentence: "…${t.slice(-25)}"`);
  if (FRAGMENT_END.test(t)) out.push(`ends inside an abbreviation: "…${t.slice(-25)}"`);
  if (!balanced(t)) out.push('unbalanced parentheses/brackets');
  if (/\s{2,}/.test(t)) out.push('double space');
  if (/\((?:r\d+[a-z]?(?:[,;]\s*)?)+\)/.test(t)) out.push('inline citation marker');
  for (const [name, rx] of ASCII_NOTATION) if (rx.test(t)) out.push(`ASCII notation (${name}): "${t.match(rx)?.[0]}"`);
  return out;
}

describe('guided tour text', () => {
  it('visits every feature beamline once, in FEATURE_META order', () => {
    const ids = TOUR.filter((s) => s.beamline).map((s) => s.beamline);
    expect(ids).toEqual(FEATURE_META.map((m) => m.id));
    for (const s of TOUR) if (s.beamline) expect(BEAMLINES[s.beamline], s.beamline).toBeDefined();
  });

  describe.each(TOUR.map((s, i) => [i, s] as const))('stop %i', (_i, s) => {
    it('text reads as whole sentences and fits the tour card', () => {
      expect(proseProblems(tourText(s)), tourText(s).slice(0, 60)).toEqual([]);
      expect(tourText(s).split(/\s+/).length, s.title).toBeLessThanOrEqual(TOUR_MAX_WORDS);
    });

    it('has a short title that names the beamline once', () => {
      expect(s.title.trim()).toBe(s.title);
      expect(s.title.length, s.title).toBeGreaterThan(3);
      expect(s.title.length, s.title).toBeLessThanOrEqual(70);
      expect(s.kicker.length, s.kicker).toBeLessThanOrEqual(60);
      if (s.beamline) {
        const acr = BEAMLINES[s.beamline].acronym;
        const n = s.title.split(new RegExp(`(?<![\\w-])${acr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![\\w-])`)).length - 1;
        expect(n, `"${s.title}" names ${acr} ${n}×`).toBe(1);
        expect(s.title.startsWith(`${acr}. `), s.title).toBe(true);
      }
    });
  });
});

describe('firstSentences (tour fallback for beamlines without curated copy)', () => {
  it('never cuts at a decimal point, an abbreviation or inside parentheses', () => {
    expect(firstSentences('The spot is 3.6 µm wide. It is small. Third.', 1)).toBe('The spot is 3.6 µm wide.');
    expect(firstSentences('Gaps of 0.5–1.2 mm. Next one.', 1)).toBe('Gaps of 0.5–1.2 mm.');
    expect(firstSentences('Edges, e.g. Fe and Co. Next.', 1)).toBe('Edges, e.g. Fe and Co.');
    expect(firstSentences('As Smith et al. Showed it. Next.', 1)).toBe('As Smith et al. Showed it.');
    expect(firstSentences('See Fig. 4 for this. Next.', 1)).toBe('See Fig. 4 for this.');
    expect(firstSentences('A lens (f = 2 m. Very short. Really) focuses. Next.', 1)).toBe('A lens (f = 2 m. Very short. Really) focuses.');
    expect(firstSentences('It said “go.” Then it went. Third.', 1)).toBe('It said “go.”');
    expect(firstSentences('One. Two! Three? Four.', 3)).toBe('One. Two! Three?');
  });

  it('drops inline citations and returns short texts whole', () => {
    expect(firstSentences('Bright (r12). Coherent (r3, r7b). More.', 2)).toBe('Bright. Coherent.');
    expect(firstSentences('No full stop at the end', 2)).toBe('No full stop at the end');
    expect(firstSentences('Only one sentence.', 3)).toBe('Only one sentence.');
  });

  it('gives whole sentences for every dossier text it could be used on', () => {
    for (const b of Object.values(BEAMLINES)) {
      const sources: [string, string | undefined, number][] = [
        ['whatAPSUEnables.text', b.whatAPSUEnables?.text, 2],
        ['summary', b.summary, 2],
      ];
      for (const [field, text, n] of sources) {
        if (!text) continue;
        const cut = firstSentences(text, n);
        const where = `${b.id}.${field}: "…${cut.slice(-40)}"`;
        const full = text.replace(/\s*\((?:r\d+[a-z]?(?:[,;]\s*)?)+\)/g, '').trim();
        expect(full.startsWith(cut), where).toBe(true);
        // the cut is followed by whitespace (a sentence boundary), never by a digit of 3.6 or the rest of a word
        if (cut.length < full.length) expect(full[cut.length], where).toMatch(/\s/);
        expect(SENTENCE_END.test(cut) || cut === full, where).toBe(true);
        expect(FRAGMENT_END.test(cut), where).toBe(false);
        expect(balanced(cut), where).toBe(true);
      }
    }
  });
});

describe('overview copy', () => {
  it('reads as whole sentences without research notation', () => {
    expect(proseProblems(OVERVIEW_COPY.text)).toEqual([]);
    for (const s of OVERVIEW_COPY.stats) if (s.note) expect(proseProblems(s.note), s.label).toEqual([]);
  });
});

// ------------------------------------------------------------------ "The upgrade" story (Overlays renders these)

/** Primer questions the story dialog shows (src/ui/Overlays.ts PRIMER). */
const PRIMER_KEYS = ['whatIsSynchrotron', 'whatIsUndulator', 'whatIsMBA', 'whyEmittanceMatters', 'whatIsCoherence', 'whatIsSwapOut', 'whatIsBunchLengthening', 'whyLowerEnergy', 'whyRoundBeams'];

describe('story copy', () => {
  it('every primer answer exists and each of its paragraphs reads as whole sentences', () => {
    for (const k of PRIMER_KEYS) {
      const text: unknown = fac.explainers?.[k];
      expect(typeof text, k).toBe('string');
      const paras = String(text).split(/\n\s*\n/);
      expect(paras.length, k).toBeLessThanOrEqual(2);
      for (const para of paras) expect(proseProblems(para.trim()), `${k}: ${para.slice(0, 50)}`).toEqual([]);
    }
  });

  it('timeline events and number cards read as whole sentences', () => {
    for (const t of fac.timeline) expect(proseProblems(t.event), `${t.date}: ${t.event.slice(0, 50)}`).toEqual([]);
    for (const n of fac.exhibitNumbers) expect(proseProblems(n.explanation), n.label).toEqual([]);
  });
});

// ------------------------------------------------------------------ one voice

/**
 * Every text exists once, for every reader: nothing on show may mention the retired Visitor / Specialist modes or
 * tell the reader to switch. (Dossier `interactiveIdeas` are design notes that are never shown.)
 */
const MODE_WORDS = [/\b(?:Visitor|Specialist)s?\b/, /\b(?:visitor|specialist|expert) (?:mode|depth|view|text|switch)\b/i, /\bfor specialists\b/i, /\bexplanation depth\b/i, /\bswitch to (?:visitor|specialist|expert)\b/i];

function modeMentions(o: unknown, path: string, out: string[]): string[] {
  if (typeof o === 'string') {
    for (const rx of MODE_WORDS) if (rx.test(o)) out.push(`${path}: "${o.match(rx)?.[0]}"`);
  } else if (Array.isArray(o)) o.forEach((x, i) => modeMentions(x, `${path}[${i}]`, out));
  else if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) if (k !== 'interactiveIdeas') modeMentions(v, `${path}.${k}`, out);
  return out;
}

describe('one voice for every reader', () => {
  it('no shown text mentions Visitor / Specialist modes', () => {
    const out: string[] = [];
    modeMentions(TOUR, 'tour', out);
    modeMentions(OVERVIEW_COPY, 'overview', out);
    modeMentions({ explainers: fac.explainers, timeline: fac.timeline, exhibitNumbers: fac.exhibitNumbers }, 'facility', out);
    modeMentions(sectors.sectors, 'sectors', out);
    for (const b of Object.values(BEAMLINES)) modeMentions(b, b.id, out);
    expect(out).toEqual([]);
  });

  it('tour stops and the overview carry a single text each (no plain/expert pairs)', () => {
    for (const s of TOUR) expect(Object.keys(s).filter((k) => /^(?:plain|expert)$/.test(k)), s.title).toEqual([]);
    expect(Object.keys(OVERVIEW_COPY).filter((k) => /^(?:plain|expert)$/.test(k))).toEqual([]);
    expect(fac.plainExplainers).toBeUndefined();
  });
});
