/** Global app state + hash router. Views are deep-linkable: #/beamline/xpcs/kb-mirror, #/tour/3 */

export type View =
  | { mode: 'overview'; focus?: string }
  | { mode: 'beamline'; id: string; component?: string }
  | { mode: 'tour'; step: number };

export type Depth = 'visitor' | 'specialist';
export type Quality = 'high' | 'balanced' | 'low';

export interface AppState {
  view: View;
  depth: Depth;
  quality: Quality;
  showRoof: boolean;
  introSeen: boolean;
  /** true once the user picked a quality themselves (the adaptive governor then stays out of the way) */
  qualityChosen: boolean;
  hover: { kind: string; id: string } | null;
}

type Listener = (s: AppState, prev: AppState) => void;

function readPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    if (v && (allowed as readonly string[]).includes(v)) return v as T;
  } catch {
    /* storage unavailable */
  }
  return fallback;
}

function writePref(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable */
  }
}

/** decodeURIComponent that never throws: a malformed %-escape is kept as typed. */
function decode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * View for a location hash. Never throws. Only the format is checked here (the app redirects views that name an
 * unknown beamline, sector or tour stop): a tour step must be a non-negative integer (else stop 0).
 */
export function parseHash(hash: string): View {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decode);
  if (parts[0] === 'beamline' && parts[1]) return { mode: 'beamline', id: parts[1], component: parts[2] };
  if (parts[0] === 'tour') {
    const n = /^\d+$/.test(parts[1] ?? '') ? Number(parts[1]) : 0;
    return { mode: 'tour', step: Number.isSafeInteger(n) ? n : 0 };
  }
  if (parts[0] === 'sector' && parts[1]) return { mode: 'overview', focus: parts[1] };
  return { mode: 'overview' };
}

export function viewToHash(v: View): string {
  switch (v.mode) {
    case 'beamline':
      return `#/beamline/${encodeURIComponent(v.id)}${v.component ? '/' + encodeURIComponent(v.component) : ''}`;
    case 'tour':
      return `#/tour/${v.step}`;
    default:
      return v.focus ? `#/sector/${encodeURIComponent(v.focus)}` : '#/';
  }
}

/** Same place (canonical hash), regardless of object identity. */
export function sameView(a: View | null | undefined, b: View | null | undefined): boolean {
  return !!a && !!b && viewToHash(a) === viewToHash(b);
}

class Store {
  state: AppState;
  private listeners = new Set<Listener>();

  constructor() {
    const isTest = typeof location !== 'undefined' && /[?&]test\b/.test(location.search);
    const qualityChosen = readPref('apsu.qualityChosen', ['yes', 'no'], 'no') === 'yes';
    this.state = {
      view: typeof location !== 'undefined' ? parseHash(location.hash) : { mode: 'overview' },
      depth: readPref<Depth>('apsu.depth', ['visitor', 'specialist'], 'visitor'),
      // only an explicit choice is remembered: the adaptive governor's downgrades last for the session
      quality: qualityChosen ? readPref<Quality>('apsu.quality', ['high', 'balanced', 'low'], 'balanced') : 'balanced',
      showRoof: false,
      introSeen: isTest || readPref('apsu.intro', ['seen', 'new'], 'new') === 'seen',
      qualityChosen,
      hover: null,
    };
  }

  subscribe(fn: Listener): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  set(patch: Partial<AppState>): void {
    const prev = this.state;
    this.state = { ...prev, ...patch };
    if (patch.depth) writePref('apsu.depth', patch.depth);
    if (patch.quality && this.state.qualityChosen) writePref('apsu.quality', patch.quality);
    if (patch.qualityChosen) writePref('apsu.qualityChosen', 'yes');
    if (patch.introSeen) writePref('apsu.intro', 'seen');
    for (const l of this.listeners) l(this.state, prev);
  }

  /** Navigate: updates the hash (pushes history) and state. */
  go(view: View, replace = false): void {
    const hash = viewToHash(view);
    if (location.hash !== hash) {
      if (replace) history.replaceState(null, '', hash);
      else history.pushState(null, '', hash);
    }
    this.set({ view });
  }
}

export const store = new Store();

if (typeof window !== 'undefined') {
  window.addEventListener('popstate', () => {
    const v = parseHash(location.hash);
    if (!sameView(v, store.state.view)) store.set({ view: v });
  });
  window.addEventListener('hashchange', () => {
    const v = parseHash(location.hash);
    if (!sameView(v, store.state.view)) store.set({ view: v });
  });
}
