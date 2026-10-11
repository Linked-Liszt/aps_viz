import { h, icon } from '../lib/dom';
import { store, type View } from '../app/store';
import { BEAMLINES } from '../data/beamlines';
import { FEATURE_META } from '../data/meta';
import { SECTOR_INFO } from '../data/sectors';
import { categoryIcon, componentKind, componentKindKey } from './categories';
import { formatDist } from './BeamlinePanel';
import { closeModals, holdExclusive, restoreFocus } from './Modal';

interface Entry {
  kind: 'beamline' | 'component' | 'technique' | 'sector';
  title: string;
  sub: string;
  /** names, labels and short descriptors: a match here ranks by kind and title */
  hay: string;
  /** the entry's exhibit text (summary, technique, component or enhancement text): a match only here ranks after every name match */
  text: string;
  view: View;
  color?: string;
  cat?: string;
}

const KIND_RANK: Record<Entry['kind'], number> = { beamline: 0, technique: 1, component: 2, sector: 3 };
/** Score added when the query is found only in an entry's text, not in its names. */
const TEXT_ONLY = 100;
const SECTORS = 35;

/**
 * Asks the beamline panel to open a given tab (e.g. 'how' for a technique). Dispatched right after navigating;
 * the panel keeps it as a pending tab and applies it on its next render.
 */
export const PANEL_TAB_EVENT = 'apsu:panel-tab';

function buildIndex(): Entry[] {
  const out: Entry[] = [];
  for (const m of FEATURE_META) {
    const b = BEAMLINES[m.id];
    if (!b) continue;
    out.push({
      kind: 'beamline',
      title: `${b.acronym} — ${m.displayName}`,
      sub: `${m.sectorNumber}-ID · ${m.short}`,
      hay: `${b.acronym} ${m.displayName} ${b.fullName} ${b.sector} ${m.stations} ${m.short} ${b.tagline}`,
      text: `${b.summary ?? ''} ${b.whatAPSUEnables?.text ?? ''}`,
      view: { mode: 'beamline', id: m.id },
      color: m.color,
    });
    for (const t of b.techniques ?? []) {
      out.push({
        kind: 'technique',
        title: t.abbrev ? `${t.name} (${t.abbrev})` : t.name,
        sub: `Technique at ${b.acronym} · opens “How it works”`,
        hay: `${t.name} ${t.abbrev ?? ''} ${b.acronym}`,
        text: t.text ?? '',
        view: { mode: 'beamline', id: m.id },
        color: m.color,
      });
    }
    for (const c of b.components) {
      if (c.distanceM === null || c.distanceM === undefined) continue;
      out.push({
        kind: 'component',
        title: c.name,
        sub: `${b.acronym} · ${componentKind({ category: String(c.category), name: c.name })} · ${formatDist(c.distanceM)}${c.enclosure ? ' · ' + c.enclosure : ''}`,
        hay: `${c.name} ${componentKind({ category: String(c.category), name: c.name })} ${c.category} ${b.acronym} ${c.enclosure ?? ''}`,
        text: c.text ?? '',
        view: { mode: 'beamline', id: m.id, component: c.id },
        color: m.color,
        cat: componentKindKey({ category: String(c.category), name: c.name }),
      });
    }
  }
  for (let n = 1; n <= SECTORS; n++) {
    const info = SECTOR_INFO[n];
    const bls = info?.beamlines ?? [];
    const names = bls.map((b) => `${b.name} ${b.title ?? ''} ${b.operator ?? ''} ${(b.techniques ?? []).join(' ')}`).join(' ');
    // enhanced beamlines of a sector share one program text: index it once
    const texts = new Set(bls.flatMap((b) => [b.summary ?? '', b.enhancement?.text ?? '']));
    out.push({
      kind: 'sector',
      title: `Sector ${n}`,
      sub: [info?.plainLabel, bls.map((b) => b.name).join(' · ')].filter(Boolean).join(' — ') || 'Beamlines in this sector',
      // the sector card spells out the APS's own division once: find it by either name
      hay: `sector ${n} ${info?.plainLabel ?? ''} ${info?.operators ?? ''}${/\bXSD\b/.test(info?.operators ?? '') ? ' X-ray Science Division' : ''} ${names}`,
      text: [...texts].join(' '),
      view: { mode: 'overview', focus: String(n) },
    });
  }
  return out;
}

/** The heading a keyboard user should land on after a search result has been opened. */
function viewHeading(v: View): HTMLElement | null {
  const q = (sel: string) => document.querySelector<HTMLElement>(sel);
  if (v.mode === 'beamline') return (v.component ? q('.bl-panel.is-open .comp-title') : null) ?? q('.bl-panel.is-open .bl-title');
  if (v.mode === 'overview') return v.focus ? q('.sector-card.is-open h4, .sector-card.is-open .kicker') : q('.ov-panel:not(.is-away) .ov-title');
  return null;
}

/** Focus the new view's heading once the app has rendered it (falls back to the page body). */
function focusView(v: View, tries = 30): void {
  requestAnimationFrame(() => {
    const el = viewHeading(v);
    if (el && el.getClientRects().length) {
      if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '-1');
      el.focus({ preventScroll: true });
    } else if (tries > 0) focusView(v, tries - 1);
    else restoreFocus(null);
  });
}

export class Search {
  readonly el: HTMLElement;
  private input: HTMLInputElement;
  private list: HTMLElement;
  private index: Entry[] | null = null;
  private results: Entry[] = [];
  private sel = 0;
  private returnFocus: Element | null = null;
  private release: (() => void) | null = null;

  constructor() {
    this.input = h('input', {
      type: 'search',
      class: 'search-input',
      placeholder: 'Search beamlines, components, techniques, sectors…',
      'aria-label': 'Search',
      role: 'combobox',
      'aria-expanded': 'true',
      'aria-controls': 'search-results',
      'aria-autocomplete': 'list',
      autocomplete: 'off',
      spellcheck: 'false',
    });
    this.list = h('ul', { class: 'search-results', role: 'listbox', id: 'search-results', 'aria-label': 'Results' });
    this.el = h(
      'div',
      { class: 'search', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Search', inert: true, onclick: (e: Event) => e.target === this.el && this.close() },
      h('div', { class: 'search-box glass' }, h('div', { class: 'search-row' }, icon('search', 18), this.input, h('kbd', null, 'Esc')), this.list),
    );
    this.input.addEventListener('input', () => this.run());
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') {
        this.sel = Math.min(this.results.length - 1, this.sel + 1);
        this.paint();
        e.preventDefault();
      } else if (e.key === 'ArrowUp') {
        this.sel = Math.max(0, this.sel - 1);
        this.paint();
        e.preventDefault();
      } else if (e.key === 'Enter') {
        const r = this.results[this.sel];
        if (r) this.pick(r);
        e.preventDefault();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        this.close();
      }
    });
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  open(): void {
    this.index ??= buildIndex();
    if (!this.isOpen) this.returnFocus = document.activeElement;
    this.el.inert = false;
    this.el.classList.add('is-open');
    this.release ??= holdExclusive(this.el);
    this.input.value = '';
    this.run();
    // focus at once (no longer inert), so keys typed right after '/' or Ctrl+K land in the field
    this.input.focus({ preventScroll: true });
    requestAnimationFrame(() => {
      if (this.isOpen && document.activeElement !== this.input) this.input.focus({ preventScroll: true });
    });
  }

  /** Close; focus goes back where it was (or, with restore=false, the caller places it). */
  close(restore = true): void {
    if (!this.isOpen) return;
    this.el.classList.remove('is-open');
    this.input.blur();
    this.release?.();
    this.release = null;
    this.el.inert = true;
    const f = this.returnFocus;
    this.returnFocus = null;
    if (restore) restoreFocus(f);
  }

  private run(): void {
    const q = this.input.value.trim().toLowerCase();
    const idx = this.index ?? [];
    if (!q) {
      this.results = idx.filter((e) => e.kind === 'beamline');
    } else {
      // a bare sector number ('19') or 'sector 19' puts that sector first
      const secMatch = /^(?:sector\s*)?(\d{1,2})$/.exec(q);
      const sector = secMatch && Number(secMatch[1]) >= 1 && Number(secMatch[1]) <= SECTORS ? `Sector ${Number(secMatch[1])}` : null;
      const toks = q.split(/\s+/);
      this.results = idx
        .map((e) => {
          const hay = e.hay.toLowerCase();
          const named = toks.every((t) => hay.includes(t));
          if (!named) {
            const all = `${hay} ${e.text.toLowerCase()}`;
            if (!toks.every((t) => all.includes(t))) return null;
          }
          if (sector && e.kind === 'sector' && e.title === sector) return { e, score: -1 };
          const title = e.title.toLowerCase();
          const score = (named ? 0 : TEXT_ONLY) + KIND_RANK[e.kind] * 10 + (title.startsWith(toks[0]) ? 0 : title.includes(toks[0]) ? 3 : 6);
          return { e, score };
        })
        .filter((x): x is { e: Entry; score: number } => !!x)
        .sort((a, b) => a.score - b.score)
        .slice(0, 40)
        .map((x) => x.e);
    }
    this.sel = 0;
    this.paint();
  }

  private paint(): void {
    this.list.replaceChildren(
      ...(this.results.length
        ? this.results.map((r, i) =>
            h(
              'li',
              {
                role: 'option',
                id: `sr-${i}`,
                'aria-selected': String(i === this.sel),
                class: i === this.sel ? 'is-sel' : '',
                style: r.color ? `--c:${r.color}` : '',
                onclick: () => this.pick(r),
                onmousemove: () => {
                  if (this.sel !== i) {
                    this.sel = i;
                    this.paint();
                  }
                },
              },
              h('span', { class: `sr-kind sr-${r.kind}`, 'aria-hidden': 'true' }, r.cat ? categoryIcon(r.cat, 14) : r.kind === 'beamline' ? h('i', { class: 'sr-dot' }) : icon(r.kind === 'sector' ? 'ring' : 'beaker', 14)),
              h('span', { class: 'sr-text' }, h('span', { class: 'sr-title' }, r.title), h('span', { class: 'sr-sub' }, r.sub)),
            ),
          )
        : [h('li', { class: 'sr-empty', role: 'option', 'aria-disabled': 'true' }, 'No matches. Try “mirror”, “XPCS”, “detector”, “ptychography” or a sector number.')]),
    );
    if (this.results.length) this.input.setAttribute('aria-activedescendant', `sr-${this.sel}`);
    else this.input.removeAttribute('aria-activedescendant');
    (this.list.querySelector('.is-sel') as HTMLElement | null)?.scrollIntoView({ block: 'nearest' });
  }

  private pick(r: Entry): void {
    this.close(false);
    // search can be opened (Ctrl+K) over a dialog; that dialog belongs to the view being left
    closeModals();
    store.go(r.view);
    if (r.kind === 'technique') window.dispatchEvent(new CustomEvent(PANEL_TAB_EVENT, { detail: 'how' }));
    focusView(r.view);
  }
}
