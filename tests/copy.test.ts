import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { OVERVIEW_COPY } from '../src/data/copy';
import { TOUR, firstSentences, type TourStep } from '../src/data/tour';
import { FEATURE_META } from '../src/data/meta';
import { BEAMLINES } from '../src/data/beamlines';

const fac = JSON.parse(readFileSync(join(__dirname, '../src/data/facility.json'), 'utf8'));
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
});

// ------------------------------------------------------------------ guided tour text

/** Visible text of a tour stop at a depth (as Overlays renders it: Specialist falls back to the plain text). */
const tourText = (s: TourStep, depth: 'visitor' | 'specialist') => (depth === 'specialist' && s.expert ? s.expert : s.plain);

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
    it.each(['visitor', 'specialist'] as const)('%s text reads as whole sentences', (depth) => {
      expect(proseProblems(tourText(s, depth)), tourText(s, depth).slice(0, 60)).toEqual([]);
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
        expect(s.title.startsWith(`${acr} — `), s.title).toBe(true);
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

  it('gives whole sentences for every dossier summary it could be used on', () => {
    for (const b of Object.values(BEAMLINES)) {
      const sources: [string, string | undefined, number][] = [
        ['whatAPSUEnables.plain', b.whatAPSUEnables?.plain, 2],
        ['whatAPSUEnables.expert', b.whatAPSUEnables?.expert, 3],
        ['plainSummary', b.plainSummary, 2],
        ['expertSummary', b.expertSummary, 3],
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
    expect(proseProblems(OVERVIEW_COPY.plain)).toEqual([]);
    expect(proseProblems(OVERVIEW_COPY.expert)).toEqual([]);
    for (const s of OVERVIEW_COPY.stats) if (s.note) expect(proseProblems(s.note), s.label).toEqual([]);
  });
});
