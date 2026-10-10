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
const NOT_PROSE = new Set(['id', 'source', 'sources', 'url', 'file', 'refs', 'branch', 'category', 'enclosure', 'deflection', 'references', 'interactiveIdeas']);

/** Every visible string under `node` (object keys are not visited), with its path. */
function proseStrings(node: unknown, path: string, skip: (key: string) => boolean, out: [string, string][] = []): [string, string][] {
  if (typeof node === 'string') out.push([path, node]);
  else if (Array.isArray(node)) node.forEach((x, i) => proseStrings(x, `${path}[${i}]`, skip, out));
  else if (node && typeof node === 'object') for (const [k, v] of Object.entries(node)) if (!skip(k)) proseStrings(v, `${path}.${k}`, skip, out);
  return out;
}

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
    for (const k of ['sector', 'acronym', 'fullName', 'tagline', 'plainSummary', 'expertSummary'] as const) {
      expect(typeof b[k], k).toBe('string');
      expect((b[k] as string).length, k).toBeGreaterThan(2);
    }
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
      expect(c.plain?.length ?? 0, `${c.id} plain text`).toBeGreaterThan(10);
      if (c.branch) expect(branchIds.has(c.branch), `${c.id} branch ${c.branch}`).toBe(true);
      if (c.source) expect(refIds.has(c.source), `${c.id} source ${c.source}`).toBe(true);
    }
    const d = b.components.map((c) => c.distanceM).filter((x): x is number => typeof x === 'number');
    for (let i = 1; i < d.length; i++) expect(d[i] + 0.51, `order at ${i}`).toBeGreaterThanOrEqual(d[i - 1]);
    void encNames;
  });

  it('enclosures are sane', () => {
    for (const e of b.enclosures) {
      expect(e.endM, e.name).toBeGreaterThan(e.startM);
      if (e.branch) expect(branchIds.has(e.branch), `${e.name} branch`).toBe(true);
    }
  });

  it('prose has no inline citation markers (sources live in fields)', () => {
    const prose = [
      b.tagline, b.plainSummary, b.expertSummary, b.whatAPSUEnables?.plain, b.whatAPSUEnables?.expert,
      ...(b.techniques ?? []).flatMap((t) => [t.plain, t.expert]),
      ...(b.scienceCases ?? []).flatMap((t) => [t.plain, t.expert]),
      ...b.components.flatMap((c) => [c.plain, c.expert]),
      ...(b.instruments ?? []).flatMap((t) => [t.plain, t.expert]),
    ].filter(Boolean) as string[];
    for (const t of prose) expect(CITE.test(t), t.slice(0, 80)).toBe(false);
  });

  it('prose uses exhibit typography, not ASCII research notation', () => {
    // summaries, whatAPSUEnables, techniques, science cases, component names/text/specs, key parameters, instruments,
    // enclosures, figure captions, fun facts, open questions …: everything the panels show
    const strings = proseStrings(b, b.id, (k) => NOT_PROSE.has(k));
    expect(strings.length).toBeGreaterThan(50);
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

  it('by-the-numbers cards, timeline and primer use exhibit typography', () => {
    const strings = [
      ...proseStrings(fac.exhibitNumbers, 'exhibitNumbers', skip),
      ...proseStrings(fac.timeline, 'timeline', skip),
      ...proseStrings(fac.plainExplainers, 'plainExplainers', skip),
    ];
    expect(strings.length).toBeGreaterThan(30);
    expect(notationProblems(strings)).toEqual([]);
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
        for (const k of ['plain', 'expert']) if (typeof b.enhancement?.[k] === 'string') strings.push([`${bp}.enhancement.${k}`, b.enhancement[k]]);
      }
    }
    expect(strings.length).toBeGreaterThan(300);
    expect(notationProblems(strings)).toEqual([]);
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
