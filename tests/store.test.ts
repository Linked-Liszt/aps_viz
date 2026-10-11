import { describe, expect, it, vi } from 'vitest';
import { parseHash, sameView, store, viewToHash, type View } from '../src/app/store';

/**
 * An in-memory localStorage, installed before store.ts is imported (it builds the Store at import time and reads the
 * saved preferences then). Saved: an obsolete explanation-depth key from earlier versions (every text now exists
 * once), a 'low' quality that the visitor never chose explicitly, and an unknown intro value.
 */
const saved = vi.hoisted(() => {
  const data = new Map<string, string>([
    ['apsu.depth', 'specialist'],
    ['apsu.quality', 'low'],
    ['apsu.intro', 'bogus'],
  ]);
  const storage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => void data.set(k, String(v)),
    removeItem: (k: string) => void data.delete(k),
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
  Object.defineProperty(globalThis, 'localStorage', { value: storage, configurable: true, writable: true });
  return data;
});

/*
 * The hash router in isolation. parseHash only checks the *format* of a hash and must never throw; the App then
 * redirects views that name no real place (unknown beamline, sector 0/99/abc, tour stop 99). Those redirects are covered
 * end to end in e2e/exhibit.spec.ts ("deep links that name no real place …").
 */

describe('parseHash', () => {
  it('reads the documented routes', () => {
    expect(parseHash('#/')).toEqual({ mode: 'overview' });
    expect(parseHash('')).toEqual({ mode: 'overview' });
    expect(parseHash('#')).toEqual({ mode: 'overview' });
    expect(parseHash('#/beamline/xpcs')).toEqual({ mode: 'beamline', id: 'xpcs', component: undefined });
    expect(parseHash('#/beamline/xpcs/kb-mirror')).toEqual({ mode: 'beamline', id: 'xpcs', component: 'kb-mirror' });
    expect(parseHash('#/tour/3')).toEqual({ mode: 'tour', step: 3 });
    expect(parseHash('#/sector/12')).toEqual({ mode: 'overview', focus: '12' });
  });

  it('falls back to the overview for unknown or incomplete routes', () => {
    for (const h of ['#/nowhere', '#/beamline', '#/beamline/', '#/sector', '#/sector/', '#//', '#/%', 'garbage']) {
      expect(() => parseHash(h), h).not.toThrow();
      expect(parseHash(h), h).toEqual({ mode: 'overview' });
    }
  });

  it('never throws on malformed %-escapes (keeps the text as typed)', () => {
    for (const h of ['#/beamline/xpcs/%E2%9C', '#/beamline/%zz', '#/sector/%', '#/tour/%E2', '#/%E2%9C/%']) {
      expect(() => parseHash(h), h).not.toThrow();
    }
    expect(parseHash('#/beamline/xpcs/%E2%9C')).toEqual({ mode: 'beamline', id: 'xpcs', component: '%E2%9C' });
    expect(parseHash('#/beamline/%zz')).toEqual({ mode: 'beamline', id: '%zz', component: undefined });
    expect(parseHash('#/sector/%')).toEqual({ mode: 'overview', focus: '%' });
    expect(parseHash('#/tour/%E2')).toEqual({ mode: 'tour', step: 0 });
  });

  it('decodes well-formed escapes', () => {
    expect(parseHash('#/beamline/xpcs/kb%20mirror')).toEqual({ mode: 'beamline', id: 'xpcs', component: 'kb mirror' });
    expect(parseHash('#/beamline/3dmn/%CE%B1-slit')).toEqual({ mode: 'beamline', id: '3dmn', component: 'α-slit' });
  });

  it('accepts only non-negative integer tour steps (anything else is stop 0; the App clamps the upper end)', () => {
    expect(parseHash('#/tour')).toEqual({ mode: 'tour', step: 0 });
    expect(parseHash('#/tour/0')).toEqual({ mode: 'tour', step: 0 });
    expect(parseHash('#/tour/abc')).toEqual({ mode: 'tour', step: 0 });
    expect(parseHash('#/tour/12abc')).toEqual({ mode: 'tour', step: 0 });
    expect(parseHash('#/tour/-2')).toEqual({ mode: 'tour', step: 0 });
    expect(parseHash('#/tour/1.5')).toEqual({ mode: 'tour', step: 0 });
    expect(parseHash('#/tour/1e3')).toEqual({ mode: 'tour', step: 0 });
    expect(parseHash('#/tour/99999999999999999999')).toEqual({ mode: 'tour', step: 0 });
    const far = parseHash('#/tour/99');
    expect(far).toEqual({ mode: 'tour', step: 99 });
    if (far.mode === 'tour') expect(Number.isSafeInteger(far.step)).toBe(true);
  });

  it('never yields a beamline or tour view for sector links, and never a NaN anywhere', () => {
    for (const h of ['#/sector/abc', '#/sector/0', '#/sector/99', '#/sector/-1', '#/sector/1e2']) {
      const v = parseHash(h);
      expect(v.mode, h).toBe('overview');
      expect(JSON.stringify(v), h).not.toMatch(/NaN|null/);
    }
  });
});

describe('viewToHash', () => {
  it('round-trips canonical hashes', () => {
    for (const h of ['#/', '#/beamline/xpcs', '#/beamline/xpcs/kb-mirror', '#/tour/0', '#/tour/4', '#/sector/12']) {
      expect(viewToHash(parseHash(h)), h).toBe(h);
    }
  });

  it('round-trips views whose ids need escaping', () => {
    const views: View[] = [
      { mode: 'overview' },
      { mode: 'overview', focus: '7' },
      { mode: 'tour', step: 12 },
      { mode: 'beamline', id: 'xpcs', component: undefined },
      { mode: 'beamline', id: 'xpcs', component: 'kb mirror/α 100%' },
      { mode: 'beamline', id: 'a#b?c', component: '%E2' },
    ];
    for (const v of views) {
      const h = viewToHash(v);
      expect(h, JSON.stringify(v)).toMatch(/^#\/[^#?\s]*$/);
      expect(parseHash(h), h).toEqual(v);
    }
  });
});

describe('sameView', () => {
  it('compares places, not object identity', () => {
    expect(sameView(parseHash('#/sector/5'), { mode: 'overview', focus: '5' })).toBe(true);
    expect(sameView(parseHash('#/sector/5'), { mode: 'overview' })).toBe(false);
    expect(sameView(parseHash('#/beamline/xpcs'), { mode: 'beamline', id: 'xpcs' })).toBe(true);
    expect(sameView(parseHash('#/beamline/xpcs/x'), { mode: 'beamline', id: 'xpcs' })).toBe(false);
    expect(sameView(null, { mode: 'overview' })).toBe(false);
    expect(sameView(undefined, undefined)).toBe(false);
  });
});

describe('store', () => {
  it('starts on the overview (no location) with the saved preferences', () => {
    expect(store.state.view).toEqual({ mode: 'overview' });
    // only an explicit quality choice is remembered; an unknown stored value falls back
    expect(store.state.qualityChosen).toBe(false);
    expect(store.state.quality).toBe('balanced');
    expect(store.state.introSeen).toBe(false);
  });

  it('has no explanation-depth state and drops the obsolete saved key', () => {
    expect(Object.keys(store.state).sort()).toEqual(['hover', 'introSeen', 'quality', 'qualityChosen', 'view']);
    expect(saved.has('apsu.depth')).toBe(false);
  });

  it('notifies subscribers with the previous state, persists explicit choices, and unsubscribes', () => {
    const seen: [string, string][] = [];
    const off = store.subscribe((s, prev) => seen.push([s.quality, prev.quality]));
    store.set({ quality: 'high', qualityChosen: true });
    expect(saved.get('apsu.quality')).toBe('high');
    expect(saved.get('apsu.qualityChosen')).toBe('yes');
    store.set({ introSeen: true });
    expect(saved.get('apsu.intro')).toBe('seen');
    off();
    store.set({ quality: 'low' });
    expect(seen).toEqual([
      ['high', 'balanced'],
      ['high', 'high'],
    ]);
    expect(saved.get('apsu.quality')).toBe('low');
  });

  it('keeps working when storage throws (private mode, blocked site data)', () => {
    const real = globalThis.localStorage;
    const broken = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {
        throw new Error('SecurityError');
      },
    };
    Object.defineProperty(globalThis, 'localStorage', { value: broken, configurable: true, writable: true });
    try {
      expect(() => store.set({ quality: 'balanced', qualityChosen: true, introSeen: true })).not.toThrow();
      expect(store.state.quality).toBe('balanced');
    } finally {
      Object.defineProperty(globalThis, 'localStorage', { value: real, configurable: true, writable: true });
    }
  });
});
