import type { BeamlineLayout } from '../scene/beamline/layout';
import { DEFAULT_LAYOUT } from '../scene/beamline/layout';

/**
 * Per-beamline geometric layouts (src/beamlines/<id>.layout.ts). Loaded lazily and independently, so a layout
 * that fails to load (e.g. mid-edit during development) only degrades its own beamline to the default layout.
 */
const loaders = import.meta.glob<{ default: BeamlineLayout }>('./*.layout.ts');
const LAYOUTS: Record<string, BeamlineLayout> = {};
let loading: Promise<void> | null = null;

export function loadLayouts(): Promise<void> {
  loading ??= Promise.allSettled(
    Object.entries(loaders).map(async ([path, load]) => {
      const id = path.replace('./', '').replace('.layout.ts', '');
      try {
        const mod = await load();
        LAYOUTS[mod.default.id ?? id] = mod.default;
      } catch (e) {
        console.error(`layout ${id} failed to load; using the default layout`, e);
      }
    }),
  ).then(() => undefined);
  return loading;
}

export function layoutFor(id: string): BeamlineLayout {
  return LAYOUTS[id] ?? DEFAULT_LAYOUT(id);
}
