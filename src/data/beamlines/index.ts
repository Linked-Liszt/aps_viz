import type { Beamline } from '../types';
import { FEATURE_META } from '../meta';

/** All researched dossiers, bundled (they are small and the overview needs their summaries). */
const modules = import.meta.glob<{ default: Beamline }>('./*.json', { eager: true });

export const BEAMLINES: Record<string, Beamline> = {};
for (const [path, mod] of Object.entries(modules)) {
  const id = path.replace('./', '').replace('.json', '');
  BEAMLINES[id] = mod.default;
}

export const featureList = (): { id: string; data?: Beamline }[] =>
  FEATURE_META.map((m) => ({ id: m.id, data: BEAMLINES[m.id] }));

export function refById(b: Beamline, id?: string) {
  if (!id) return undefined;
  return b.references.find((r) => r.id === id);
}
