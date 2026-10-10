import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/*
 * three.js renders the whole opaque scene a second time into a transmission buffer, every frame, as soon as one
 * visible material has `transmission > 0`. The beamline kits use alpha blending with a clearcoat sheen for glass,
 * windows and diamond anvils instead (see src/beamlines/<id>/kit.ts). This guards against that regressing.
 */

const SRC = join(__dirname, '../src');

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...sourceFiles(p));
    else if (/\.(?:ts|tsx|js|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/** `transmission: 0.9`, `transmission = 1` or `.transmission = .5` (a literal non-zero value). */
const TRANSMISSIVE = /\btransmission\s*[:=]\s*(?!0(?:\.0*)?(?![\d.]))\.?\d[\d.]*/g;

describe('materials', () => {
  const files = sourceFiles(SRC);

  it('finds the sources', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('the pattern recognises transmissive materials and nothing else', () => {
    const hits = (s: string) => (s.match(TRANSMISSIVE) ?? []).length;
    for (const yes of ['transmission: 1', 'transmission:0.9', 'mat.transmission = 0.5', 'transmission = .5', '{ transmission: 1.0, ior: 2.4 }', 'transmission: 0.01'])
      expect(hits(yes), yes).toBe(1);
    for (const no of ['transmission: 0', 'transmission: 0.0', 'transmission: 0,', 'transmissionCentre', 'const T = sim.transmissionCentre;', 'amplitude transmission t(x) = exp(-x²)', 'transmission: t'])
      expect(hits(no), no).toBe(0);
  });

  it('no material uses transmission (it costs a full extra scene render per frame)', () => {
    const found: string[] = [];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n');
      lines.forEach((line, i) => {
        if (TRANSMISSIVE.test(line)) found.push(`${relative(SRC, f)}:${i + 1}: ${line.trim()}`);
        TRANSMISSIVE.lastIndex = 0;
      });
    }
    expect(found).toEqual([]);
  });
});
