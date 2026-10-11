import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Beamline } from '../src/data/types';

const DIR = join(__dirname, '../src/data/beamlines');
const PUBLIC = join(__dirname, '../public');
const CATEGORIES = new Set([
  'undulator', 'frontEnd', 'shutter', 'slits', 'window', 'filter', 'attenuator', 'mirror', 'monochromator', 'multilayerMono', 'crl',
  'transfocator', 'kbMirror', 'zonePlate', 'mll', 'phaseRetarder', 'polarizationAnalyzer', 'collimator', 'beamStop', 'diagnostics',
  'beamPipe', 'sample', 'diffractometer', 'goniometer', 'sampleEnvironment', 'detector', 'spectrometer', 'analyzer', 'flightTube',
  'wire', 'codedAperture', 'other',
]);
const STATES = new Set(['user-operations', 'commissioning', 'construction', 'planned', 'unknown']);
const CITE = /\((?:r\d+[a-z]?(?:[,;]\s*)?)+\)|\[(?:r\d+[a-z]?(?:[,;]\s*)?)+\]/;

const files: string[] = existsSync(DIR) ? readdirSync(DIR).filter((f: string) => f.endsWith('.json')) : [];

/**
 * Research notation that must not reach the exhibit: ASCII units and symbols where the panels show text verbatim.
 * (Sub/superscripts are written _{x} and ^{2}; a bare caret is shown as typed.)
 */
const ASCII_NOTATION: [string, RegExp][] = [
  ['um for µm', /\d\s?um\b/],
  ['urad for µrad', /\d\s?urad\b/],
  ['-> for →', /\s->\s/],
  ['sqrt for √', /\bsqrt/],
  ['deg for °', /\d\s?deg\b/],
  ['e-notation for × 10ⁿ', /\d(?:\.\d+)?e[-+]?\d+/],
  ['+/- for ±', /\+\/-/],
  ['ASCII * for × or ·', /\s\*\s/],
  ['ASCII x between numbers', /\d\s+x\s+\d/],
  ['bare caret power', /\^(?!\{)/],
  ['mm2/nm2 for mm²/nm²', /\b(?:mm|nm|µm|um)2\b/],
  ['spelled-out Greek', /\b(?:sigma|theta|lambda)\b/],
];
/** Keys whose values are identifiers, file names, links or citations rather than visible prose. */
const NOT_PROSE = new Set(['id', 'sources', 'url', 'file', 'refs', 'branch', 'category', 'enclosure', 'deflection', 'references', 'interactiveIdeas']);
/**
 * `source` is a reference id on components, instruments, figures and key parameters, but the dossier's top-level
 * `source` object (insertion devices, canting, front end, source size) is shown in the panel's Specs tab.
 */
const notProse = (k: string, v: unknown) => NOT_PROSE.has(k) || (k === 'source' && typeof v === 'string');

/** Every visible string under `node` (object keys are not visited), with its path. */
function proseStrings(node: unknown, path: string, skip: (key: string, value: unknown) => boolean, out: [string, string][] = []): [string, string][] {
  if (typeof node === 'string') out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((x, i) => proseStrings(x, `${path}[${i}]`, skip, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) if (!skip(k, v)) proseStrings(v, `${path}.${k}`, skip, out);
  return out;
}

/** Every key used anywhere under `node`, with its path. */
function keyPaths(node: unknown, path: string, out: [string, string][] = []): [string, string][] {
  if (Array.isArray(node)) node.forEach((x, i) => keyPaths(x, `${path}[${i}]`, out));
  else if (node && typeof node === 'object')
    for (const [k, v] of Object.entries(node)) {
      out.push([`${path}.${k}`, k]);
      keyPaths(v, `${path}.${k}`, out);
    }
  return out;
}

/**
 * The exhibit has one voice: no text exists in a second "depth" (the old dual-text keys plain/expert,
 * plainSummary/expertSummary, plainExplainers), and no displayed text names the old reading modes.
 */
const DUAL_TEXT_KEY = /^(?:plain|expert)(?:Summary|Explainers)?$/;
const MODE_TALK = /\b(?:visitor|specialist)s?\b|\bexpert mode\b|\bexplanation depth\b/i;

const words = (s: string) => s.trim().split(/\s+/).filter(Boolean).length;

function notationProblems(strings: [string, string][]): string[] {
  const out: string[] = [];
  for (const [path, text] of strings)
    for (const [name, rx] of ASCII_NOTATION) {
      const m = rx.exec(text);
      if (m) out.push(`${path}: ${name} in "…${text.slice(Math.max(0, m.index - 25), m.index + m[0].length + 15)}…"`);
    }
  return out;
}

describe.each(files)('beamline dossier %s', (file: string) => {
  const b = JSON.parse(readFileSync(join(DIR, file), 'utf8')) as Beamline;
  const refIds = new Set(b.references.map((r) => r.id));
  const branchIds = new Set((b.branches ?? []).map((x) => x.id));
  const encNames = new Set(b.enclosures.map((e) => e.name));

  it('has the core exhibit fields', () => {
    expect(b.id).toBe(file.replace('.json', ''));
    for (const k of ['sector', 'acronym', 'fullName', 'tagline', 'summary'] as const) {
      expect(typeof b[k], k).toBe('string');
      expect((b[k] as string).length, k).toBeGreaterThan(2);
    }
    expect(typeof b.whatAPSUEnables?.text, 'whatAPSUEnables.text').toBe('string');
    expect(b.whatAPSUEnables.text.length, 'whatAPSUEnables.text').toBeGreaterThan(40);
    expect(Array.isArray(b.whatAPSUEnables.quantitative), 'whatAPSUEnables.quantitative').toBe(true);
    expect(STATES.has(b.status2026.state), `status ${b.status2026.state}`).toBe(true);
    expect(b.tagline.split(/\s+/).length).toBeLessThanOrEqual(30);
    expect(b.components.length).toBeGreaterThan(4);
    expect(b.references.length).toBeGreaterThan(3);
    expect(b.totalLengthM).toBeGreaterThan(20);
  });

  it('components are well-formed and ordered along the beam', () => {
    const ids = new Set<string>();
    for (const c of b.components) {
      expect(ids.has(c.id), `duplicate id ${c.id}`).toBe(false);
      ids.add(c.id);
      expect(CATEGORIES.has(String(c.category)), `${c.id} category ${c.category}`).toBe(true);
      expect(c.distanceM === null || typeof c.distanceM === 'number', `${c.id} distance`).toBe(true);
      if (typeof c.distanceM === 'number') expect(c.distanceM).toBeGreaterThanOrEqual(-10);
      expect(typeof c.text === 'string' && c.text.trim().length > 10, `${c.id} text`).toBe(true);
      if (c.branch) expect(branchIds.has(c.branch), `${c.id} branch ${c.branch}`).toBe(true);
      if (c.source) expect(refIds.has(c.source), `${c.id} source ${c.source}`).toBe(true);
    }
    const d = b.components.map((c) => c.distanceM).filter((x): x is number => typeof x === 'number');
    for (let i = 1; i < d.length; i++) expect(d[i] + 0.51, `order at ${i}`).toBeGreaterThanOrEqual(d[i - 1]);
    void encNames;
  });

  it('every text exists once: one non-empty text per item, no plain/expert variants', () => {
    const items: [string, { text?: unknown }][] = [
      ...(b.techniques ?? []).map((t, i) => [`techniques[${i}] ${t.name}`, t] as [string, { text?: unknown }]),
      ...(b.scienceCases ?? []).map((t, i) => [`scienceCases[${i}] ${t.title}`, t] as [string, { text?: unknown }]),
      ...(b.instruments ?? []).map((t, i) => [`instruments[${i}] ${t.name}`, t] as [string, { text?: unknown }]),
      ...b.components.map((c) => [`components ${c.id}`, c] as [string, { text?: unknown }]),
    ];
    expect(b.techniques?.length ?? 0).toBeGreaterThan(0);
    expect(b.scienceCases?.length ?? 0).toBeGreaterThan(0);
    for (const [at, it] of items) expect(typeof it.text === 'string' && it.text.trim().length > 10, `${at}: text`).toBe(true);
    // anywhere in the dossier (design notes included): the dual-text schema is gone
    const dual = keyPaths(b, b.id).filter(([, k]) => DUAL_TEXT_KEY.test(k)).map(([p]) => p);
    expect(dual).toEqual([]);
  });

  it('texts are museum-label length, not two versions pasted together', () => {
    // guide: summary ≤ ~150 words, whatAPSUEnables.text ≤ ~160, components 40–90 (central ones up to ~130),
    // techniques, science cases and instruments 3–6 sentences; the limits below leave room for that "~"
    const over: string[] = [];
    const check = (at: string, s: string, max: number) => {
      if (words(s) > max) over.push(`${at}: ${words(s)} words > ${max}`);
    };
    check('summary', b.summary, 175);
    check('whatAPSUEnables.text', b.whatAPSUEnables.text, 185);
    for (const c of b.components) check(`components ${c.id}`, c.text, 150);
    for (const t of b.techniques ?? []) check(`techniques ${t.name}`, t.text, 180);
    for (const t of b.scienceCases ?? []) check(`scienceCases ${t.title}`, t.text, 180);
    for (const t of b.instruments ?? []) check(`instruments ${t.name}`, t.text, 180);
    expect(over).toEqual([]);
  });

  it('no displayed text talks about Visitor/Specialist modes', () => {
    const hits = proseStrings(b, b.id, notProse)
      .filter(([, s]) => MODE_TALK.test(s))
      .map(([p, s]) => `${p}: "${s.slice(0, 90)}…"`);
    expect(hits).toEqual([]);
  });

  it('enclosures are sane', () => {
    for (const e of b.enclosures) {
      expect(e.endM, e.name).toBeGreaterThan(e.startM);
      if (e.branch) expect(branchIds.has(e.branch), `${e.name} branch`).toBe(true);
    }
  });

  it('prose and fine print have no inline citation markers (sources live in fields)', () => {
    // fun facts and the quantitative list are shown through stripRefs, so they may still carry (r3)-style markers
    const prose = [
      b.tagline, b.summary, b.whatAPSUEnables?.text, b.geometryNotes,
      ...(b.techniques ?? []).map((t) => t.text),
      ...(b.scienceCases ?? []).map((t) => t.text),
      ...b.components.flatMap((c) => [c.text, c.distanceNote]),
      ...(b.instruments ?? []).flatMap((t) => [t.text, ...(t.detectors ?? []), ...(t.sampleEnvironments ?? [])]),
      ...(b.figures ?? []).flatMap((f) => [f.caption, f.whatItShows]),
      ...(b.openQuestions ?? []),
    ].filter(Boolean) as string[];
    for (const t of prose) expect(CITE.test(t), t.slice(0, 80)).toBe(false);
  });

  it('prose uses exhibit typography, not ASCII research notation', () => {
    // the unified prose (summary, whatAPSUEnables, techniques, science cases, component and instrument text) and the
    // fine print shown to everyone (quantitative, geometryNotes, figure whatItShows, open questions, distance notes,
    // detectors, sample environments, source.*, key-parameter notes), plus names, specs, captions and fun facts
    const strings = proseStrings(b, b.id, notProse);
    expect(strings.length).toBeGreaterThan(50);
    const paths = strings.map(([p]) => p);
    for (const field of ['.summary', '.whatAPSUEnables.text', '.whatAPSUEnables.quantitative[0]', '.components[0].text', '.source.insertionDevices[0].name'])
      expect(paths, `${field} is checked`).toContain(`${b.id}${field}`);
    expect(notationProblems(strings)).toEqual([]);
  });

  it('references and figures resolve', () => {
    for (const s of b.scienceCases ?? []) for (const r of s.refs ?? []) expect(refIds.has(r), `science ref ${r}`).toBe(true);
    for (const f of b.figures ?? []) {
      const p = join(PUBLIC, 'figures', f.file.replace(/^figs\//, ''));
      expect(existsSync(p), p).toBe(true);
    }
    for (const r of b.references) if (r.url) expect(r.url).toMatch(/^https?:\/\//);
  });
});

describe('facility story text', () => {
  const fac = JSON.parse(readFileSync(join(__dirname, '../src/data/facility.json'), 'utf8'));
  // `note`/`source` fields and `*_source`/`*_note` explainer keys are research annotations, not shown
  const skip = (k: string) => k === 'source' || k === 'note' || /_(?:source|note)$/.test(k);
  const shown = () => [
    ...proseStrings(fac.exhibitNumbers, 'exhibitNumbers', skip),
    ...proseStrings(fac.timeline, 'timeline', skip),
    ...proseStrings(fac.explainers, 'explainers', skip),
  ];

  it('has one text per card, timeline entry and primer answer', () => {
    expect(fac.exhibitNumbers.length).toBeGreaterThan(3);
    for (const n of fac.exhibitNumbers) expect(typeof n.explanation === 'string' && n.explanation.length > 10, `${n.label} explanation`).toBe(true);
    for (const t of fac.timeline) expect(typeof t.event === 'string' && t.event.length > 5, `${t.date} event`).toBe(true);
    const answers = Object.entries(fac.explainers ?? {}).filter(([k]) => !skip(k));
    expect(answers.length).toBeGreaterThan(3);
    for (const [k, v] of answers) expect(typeof v === 'string' && v.length > 40, `explainers.${k}`).toBe(true);
    const dual = [...keyPaths(fac.exhibitNumbers, 'exhibitNumbers'), ...keyPaths(fac.timeline, 'timeline'), ...keyPaths(fac, 'facility').filter(([p]) => p.split('.').length === 2)]
      .filter(([, k]) => DUAL_TEXT_KEY.test(k))
      .map(([p]) => p);
    expect(dual).toEqual([]);
  });

  it('by-the-numbers cards, timeline and primer use exhibit typography', () => {
    const strings = shown();
    expect(strings.length).toBeGreaterThan(30);
    expect(notationProblems(strings)).toEqual([]);
  });

  it('no story text talks about Visitor/Specialist modes', () => {
    expect(shown().filter(([, s]) => MODE_TALK.test(s)).map(([p]) => p)).toEqual([]);
  });
});

describe('sector card text', () => {
  // only what App.renderSectorCard shows: research fields (asBuilt, deliveryStatus, notes, …) stay in the JSON
  const sec = JSON.parse(readFileSync(join(__dirname, '../src/data/sectors.json'), 'utf8')).sectors as Record<string, any>;

  it('names, summaries, techniques and enhancements use exhibit typography', () => {
    const strings: [string, string][] = [];
    for (const [n, s] of Object.entries(sec)) {
      const at = `sectors.${n}`;
      for (const k of ['operators', 'plainLabel', 'lom']) if (typeof s[k] === 'string') strings.push([`${at}.${k}`, s[k]]);
      for (const [i, b] of (s.beamlines ?? []).entries()) {
        const bp = `${at}.beamlines[${i}]`;
        for (const k of ['name', 'title', 'summary', 'operator', 'status']) if (typeof b[k] === 'string') strings.push([`${bp}.${k}`, b[k]]);
        for (const [j, t] of (b.techniques ?? []).entries()) strings.push([`${bp}.techniques[${j}]`, t]);
        if (typeof b.enhancement?.text === 'string') strings.push([`${bp}.enhancement.text`, b.enhancement.text]);
      }
    }
    expect(strings.length).toBeGreaterThan(300);
    expect(notationProblems(strings)).toEqual([]);
    expect(strings.filter(([, s]) => MODE_TALK.test(s)).map(([p]) => p)).toEqual([]);
  });

  it('APS-U enhancements have one text each, no plain/expert variants', () => {
    let n = 0;
    for (const [num, s] of Object.entries(sec))
      for (const [i, b] of (s.beamlines ?? []).entries()) {
        if (!b.enhancement) continue;
        n++;
        const at = `sectors.${num}.beamlines[${i}].enhancement`;
        expect(typeof b.enhancement.text === 'string' && b.enhancement.text.length > 20, `${at}.text`).toBe(true);
        expect(Object.keys(b.enhancement).filter((k) => DUAL_TEXT_KEY.test(k)), at).toEqual([]);
      }
    expect(n).toBeGreaterThan(10);
  });
});

describe('site', () => {
  it('has the documented ring geometry', () => {
    const s = JSON.parse(readFileSync(join(__dirname, '../src/data/site.json'), 'utf8'));
    expect(s.sectors).toBe(40);
    expect(s.clockwise).toBe(true);
    expect(s.orbitRadiusM).toBeGreaterThan(170);
    expect(s.hallOuterM).toBeGreaterThan(s.orbitRadiusM + 15);
  });
});
