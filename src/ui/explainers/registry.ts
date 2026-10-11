/**
 * Interactive stations. Each module renders a simulation in a host element using canvas, SVG or DOM elements.
 * Its destroy function removes the station and releases its resources.
 */
export interface ExplainerContext {
  /** beamline accent colour */
  color: string;
  /** optional beamline id the explainer is shown for */
  beamlineId?: string;
}

export interface ExplainerInstance {
  destroy(): void;
}

export interface ExplainerModule {
  title: string;
  /** one-line prompt shown above the station, e.g. "Drag the slider to heat the sample" */
  subtitle: string;
  mount(host: HTMLElement, ctx: ExplainerContext): ExplainerInstance;
}

type Loader = () => Promise<{ default: ExplainerModule }>;

/** Load each station module when it is opened. */
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
