import type { Depth } from '../../app/store';

/**
 * Interactive "exhibit stations". Each explainer is a self-contained module that renders into a host element
 * (canvas/SVG/DOM), runs its own small simulation, and cleans up after itself.
 */
export interface ExplainerContext {
  depth: Depth;
  /** beamline accent colour */
  color: string;
  /** optional beamline id the explainer is shown for */
  beamlineId?: string;
}

export interface ExplainerInstance {
  destroy(): void;
  setDepth?(d: Depth): void;
}

export interface ExplainerModule {
  title: string;
  /** one-line prompt shown above the station, e.g. "Drag the slider to heat the sample" */
  subtitle: string;
  mount(host: HTMLElement, ctx: ExplainerContext): ExplainerInstance;
}

type Loader = () => Promise<{ default: ExplainerModule }>;

/** Lazy-loaded so each station's code ships only when opened. */
export const EXPLAINERS: Record<string, Loader> = {
  xpcs: () => import('./xpcs'),
  ptycho: () => import('./ptycho'),
  laue: () => import('./laue'),
  xmcd: () => import('./xmcd'),
  hedm: () => import('./hedm'),
  bcdi: () => import('./bcdi'),
  gisaxs: () => import('./gisaxs'),
  nanoprobe: () => import('./nanoprobe'),
  coherence: () => import('./coherence'),
  undulator: () => import('./undulator'),
  mba: () => import('./mba'),
  brightness: () => import('./brightness'),
};

export async function loadExplainer(id: string): Promise<ExplainerModule | null> {
  const l = EXPLAINERS[id];
  if (!l) return null;
  try {
    return (await l()).default;
  } catch (e) {
    console.error('explainer failed to load', id, e);
    return null;
  }
}
