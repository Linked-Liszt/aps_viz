import '../styles/panel.css';
import { h, p, icon, clear, rich } from '../lib/dom';
import { store, type Depth } from '../app/store';
import type { Beamline, BeamlineComponent, BeamlineMeta, Figure, Reference } from '../data/types';
import { loadExplainer, type ExplainerInstance } from './explainers/registry';
import { categoryIcon, componentKind, componentKindKey } from './categories';

export type PanelTab = 'overview' | 'how' | 'inside' | 'science' | 'specs';

const TABS: { id: PanelTab; label: string; short?: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'how', label: 'How it works' },
  { id: 'inside', label: 'Inside' },
  { id: 'science', label: 'Science' },
  { id: 'specs', label: 'Specs & sources', short: 'Specs' },
];

const STATUS_LABEL: Record<string, string> = {
  'user-operations': 'In user operation',
  commissioning: 'Commissioning',
  construction: 'Under construction',
  planned: 'Planned',
  unknown: 'Status unconfirmed',
};

/** Research bookkeeping that belongs in Specialist mode only (visitors see the value, not the paper trail). */
const INTERNAL_NOTE = /conflict|open question/i;

const tabId = (t: PanelTab) => `blp-tab-${t}`;
const PANEL_ID = 'blp-tabpanel';
const TITLE_ID = 'blp-title';

/** Where keyboard focus should land after the next body render (set by in-panel actions only). */
type FocusIntent = { kind: 'title' } | { kind: 'stop'; id: string } | { kind: 'tab' };

/**
 * The right-hand exhibit panel for one beamline. Text adapts to the Visitor/Specialist depth setting.
 * The header and tab buttons are persistent (built once per beamline); only the tab panel body is re-rendered, and only
 * when the beamline, tab, component or depth actually changes.
 */
export class BeamlinePanel {
  readonly el: HTMLElement;
  private head: HTMLElement;
  private tabRow: HTMLElement;
  private tabBtns = new Map<PanelTab, HTMLButtonElement>();
  private body: HTMLElement;
  private live: HTMLElement;
  private tab: PanelTab = 'overview';
  private b: Beamline | null = null;
  private meta: BeamlineMeta | null = null;
  private componentId: string | null = null;
  private explainer: ExplainerInstance | null = null;
  private explainerToken = 0;
  /** technique notes under the persistent station host (How tab), re-filled on depth changes */
  private techHost: HTMLElement | null = null;
  private renderedKey = '';
  private pendingTab: PanelTab | null = null;
  private focusIntent: FocusIntent | null = null;
  private announced = '';
  onSelectComponent: (id: string | null) => void = () => {};
  /** component ids the 3D layout does not draw (kept out of numbered lists so numbers match the pins) */
  hiddenIds = new Set<string>();
  onClose: () => void = () => {};
  onExpandExplainer: (id: string) => void = () => {};
  /**
   * Show a design-record figure large (the app passes these nodes to its Modal). Until that is wired, the
   * full-resolution image opens in a new tab, so the control always does something.
   */
  onOpenFigure: (content: Node[], label: string, src: string) => void = (_c, _l, src) => {
    window.open(src, '_blank', 'noopener');
  };

  constructor() {
    this.head = h('div', { class: 'bl-head-host' });
    this.tabRow = h('div', { class: 'tab-row', role: 'tablist', 'aria-label': 'Beamline sections' });
    TABS.forEach((t, i) => {
      const btn = h(
        'button',
        {
          class: 'tab',
          type: 'button',
          role: 'tab',
          id: tabId(t.id),
          'aria-controls': PANEL_ID,
          'aria-selected': 'false',
          tabindex: '-1',
          onclick: () => this.selectTab(t.id),
          onkeydown: (e: KeyboardEvent) => {
            const n = TABS.length;
            const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
            if (j < 0) return;
            e.preventDefault();
            e.stopPropagation();
            this.tabBtns.get(TABS[j].id)?.focus();
            this.selectTab(TABS[j].id);
          },
        },
        t.short ? [h('span', { class: 'tab-full' }, t.label), h('span', { class: 'tab-short' }, t.short)] : t.label,
      );
      this.tabBtns.set(t.id, btn);
      this.tabRow.appendChild(btn);
    });
    this.body = h('div', { class: 'panel-body', id: PANEL_ID, role: 'tabpanel', tabindex: '0', 'aria-labelledby': tabId(this.tab) });
    // one short, polite message per selection instead of announcing the whole panel (and every live station readout)
    this.live = h('div', { class: 'blp-sr', role: 'status' });
    this.el = h('aside', { class: 'bl-panel glass', 'aria-label': 'Beamline' }, this.head, this.tabRow, this.body, this.live);
    this.el.inert = true;
    store.subscribe((s, prev) => {
      if (s.depth !== prev.depth && this.b) this.onDepth(s.depth);
    });
    // Other UI (e.g. search) can ask for a tab, before or after it navigates: the next show() applies it (the app
    // applies views in a microtask); if no show() came by the end of this task, it applies to the open panel.
    window.addEventListener('apsu:panel-tab', (e) => {
      const t = (e as CustomEvent<unknown>).detail;
      if (!TABS.some((x) => x.id === t)) return;
      this.pendingTab = t as PanelTab;
      setTimeout(() => {
        const pt = this.pendingTab;
        this.pendingTab = null;
        if (pt && this.b) this.setTab(pt);
      }, 0);
    });
  }

  show(b: Beamline, meta: BeamlineMeta, componentId?: string | null): void {
    const same = this.b?.id === b.id;
    const prevComp = this.componentId;
    this.b = b;
    this.meta = meta;
    this.el.style.setProperty('--c', meta.color);
    this.el.classList.add('is-open');
    this.el.inert = false;
    if (!same) {
      this.renderHead(b, meta);
      this.el.setAttribute('aria-label', `${b.acronym} beamline`);
    }
    if (componentId) {
      this.componentId = componentId;
      this.tab = 'inside';
    } else {
      this.componentId = null;
      if (this.pendingTab) this.tab = this.pendingTab;
      else if (!same) this.tab = 'overview';
    }
    this.pendingTab = null;
    // a keyboard user acting from inside the card ([ ] or Esc while on it) keeps their place instead of landing on the
    // bare tab panel: the new card's title, or the stop they just left
    const active = document.activeElement;
    if (!this.focusIntent && same && this.tab === 'inside' && !!active && active !== this.body && this.body.contains(active)) {
      if (componentId && componentId !== prevComp) this.focusIntent = { kind: 'title' };
      else if (!componentId && prevComp) this.focusIntent = { kind: 'stop', id: prevComp };
    }
    const titleFocus = this.focusIntent?.kind === 'title';
    this.render();
    if (!same) this.announce(`${b.acronym}, ${meta.displayName}`);
    else if (componentId && componentId !== prevComp && !titleFocus) {
      // focus did not move into the panel (3D pick, strip, [ ] keys): say where the camera went
      const c = b.components.find((q) => q.id === componentId);
      if (c) this.announce(`Inside: ${c.name}, ${formatDist(c.distanceM)} from source`);
    } else if (!componentId) this.announced = '';
  }

  hide(): void {
    this.el.classList.remove('is-open');
    this.el.inert = true;
    this.destroyExplainer();
    this.b = null;
    this.renderedKey = '';
    this.announced = '';
  }

  setTab(t: PanelTab): void {
    this.tab = t;
    if (t !== 'inside') this.componentId = null;
    this.render();
  }

  /**
   * A tab chosen by the visitor. Leaving a selected component (including a click on Inside itself, which goes back to
   * the list of stops) hands the camera back to the whole beamline; without one the camera stays where it is.
   */
  private selectTab(t: PanelTab): void {
    const hadComponent = this.componentId !== null;
    this.setTab(t);
    if (hadComponent) this.onSelectComponent(null);
  }

  /**
   * Select (or clear) a component from inside the panel, then move focus to `intent` in the re-rendered body. The app
   * applies the new view in a microtask, so the intent waits for that render and expires after the current task.
   */
  private go(id: string | null, intent: FocusIntent): void {
    this.focusIntent = intent;
    this.onSelectComponent(id);
    setTimeout(() => {
      if (this.focusIntent === intent) this.focusIntent = null;
    }, 0);
  }

  private get depth(): Depth {
    return store.state.depth;
  }

  private txt(plain: string | undefined, expert: string | undefined): string {
    if (this.depth === 'specialist') return expert || plain || '';
    return plain || expert || '';
  }

  private announce(msg: string): void {
    if (msg === this.announced) return;
    this.announced = msg;
    // clear first so assistive tech treats a repeated message as new
    this.live.textContent = '';
    setTimeout(() => {
      if (this.announced === msg) this.live.textContent = msg;
    }, 60);
  }

  private key(): string {
    return `${this.b?.id}|${this.tab}|${this.componentId ?? ''}|${this.depth}`;
  }

  private renderHead(b: Beamline, meta: BeamlineMeta): void {
    const status = b.status2026?.state ?? 'unknown';
    const multi = /,/.test(meta.stations);
    this.head.replaceChildren(
      h(
        'header',
        { class: 'bl-head' },
        h(
          'div',
          { class: 'bl-head-top' },
          // the chips wrap among themselves; the close button stays top-right on every width
          h(
            'div',
            { class: 'bl-head-chips' },
            h('span', { class: 'bl-sector mono', title: `Sector ${meta.sectorNumber} insertion-device beamline` }, `${meta.sectorNumber}-ID`),
            meta.stations ? h('span', { class: 'bl-stations' }, `${multi ? 'Stations' : 'Station'} `, h('span', { class: 'mono' }, meta.stations)) : null,
            h('span', { class: `status status-${status}`, title: b.status2026?.detail ?? '' }, STATUS_LABEL[status] ?? status),
          ),
          h('button', { class: 'btn btn-ghost btn-icon bl-close', type: 'button', 'aria-label': 'Close beamline and return to the APS', title: 'Back to the whole APS (Esc)', onclick: () => this.onClose() }, icon('close')),
        ),
        h('h2', { class: 'bl-title', id: TITLE_ID, tabindex: '-1' }, b.acronym),
        h('div', { class: 'bl-fullname' }, meta.displayName),
      ),
    );
  }

  private syncTabs(): void {
    for (const [id, btn] of this.tabBtns) {
      const on = id === this.tab;
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
    }
    this.body.setAttribute('aria-labelledby', tabId(this.tab));
  }

  private render(opts: { keepScroll?: boolean } = {}): void {
    const b = this.b;
    const meta = this.meta;
    if (!b || !meta) return;
    this.syncTabs();
    const key = this.key();
    if (key === this.renderedKey) return;
    // same beamline, tab and component: only the depth changed, so keep the reader's place
    const keepScroll = opts.keepScroll ?? this.renderedKey.split('|').slice(0, 3).join('|') === key.split('|').slice(0, 3).join('|');
    this.renderedKey = key;
    const active = document.activeElement;
    const focusWasInBody = !!active && active !== this.body && this.body.contains(active);
    // a depth-only re-render (e.g. the V key) puts focus back on the same control when it still exists
    const sig = focusWasInBody && keepScroll ? focusSig(active as HTMLElement) : null;
    this.destroyExplainer();
    this.techHost = null;
    clear(this.body);
    switch (this.tab) {
      case 'overview':
        this.renderOverview(b);
        break;
      case 'how':
        this.renderHow(b, meta);
        break;
      case 'inside':
        this.renderInside(b);
        break;
      case 'science':
        this.renderScience(b);
        break;
      case 'specs':
        this.renderSpecs(b, meta);
        break;
    }
    if (!keepScroll) this.body.scrollTop = 0;
    this.applyFocus(focusWasInBody, sig);
  }

  private applyFocus(focusWasInBody: boolean, sig: FocusSig | null = null): void {
    const intent = this.focusIntent;
    this.focusIntent = null;
    let target: HTMLElement | null = null;
    if (intent?.kind === 'title') target = this.body.querySelector<HTMLElement>('.comp-title');
    else if (intent?.kind === 'stop') target = this.body.querySelector<HTMLElement>(`.stop-btn[data-id="${CSS.escape(intent.id)}"]`) ?? this.body.querySelector<HTMLElement>('.stop-btn');
    else if (intent?.kind === 'tab') target = this.tabBtns.get(this.tab) ?? null;
    if (target) {
      target.focus({ preventScroll: intent?.kind === 'title' });
      if (intent?.kind === 'stop') target.scrollIntoView({ block: 'nearest' });
    } else if (focusWasInBody) {
      // the focused control was replaced: its twin if there is one, else keep focus in the panel (never <body>)
      const twin = sig ? Array.from(this.body.querySelectorAll<HTMLElement>(sig.tag)).find((el) => sameSig(focusSig(el), sig)) : undefined;
      (twin ?? this.body).focus({ preventScroll: true });
    }
  }

  private onDepth(d: Depth): void {
    const b = this.b;
    if (!b) return;
    if (this.tab === 'how' && this.techHost && (!this.explainer || this.explainer.setDepth)) {
      // keep the station (its sliders, its scroll position): it re-labels itself; only the notes below are re-written.
      // A station still loading mounts with the new depth when it arrives.
      this.explainer?.setDepth?.(d);
      this.fillTechniques(b);
      this.renderedKey = this.key();
      return;
    }
    this.render({ keepScroll: true });
  }

  // ---------------------------------------------------------------- tabs

  private renderOverview(b: Beamline): void {
    const body = this.body;
    body.append(
      h('p', { class: 'lede' }, rich(b.tagline)),
      h(
        'div',
        { class: 'cta-row' },
        h('button', { class: 'btn btn-primary', type: 'button', onclick: () => this.openTab('how') }, icon('play', 15), 'Try the interactive station'),
        h('button', { class: 'btn', type: 'button', onclick: () => this.openTab('inside') }, icon('layers', 15), 'Walk the beamline'),
      ),
      p(this.txt(b.plainSummary, b.expertSummary)),
    );
    const w = b.whatAPSUEnables;
    if (w) {
      const text = this.txt(w.plain, w.expert);
      const card = h('section', { class: 'callout' }, h('div', { class: 'kicker' }, icon('sparkles', 14), ' What the upgrade makes possible'));
      const [first, rest] = this.depth === 'visitor' ? splitFirstSentence(text) : [text, ''];
      const lead = p(first);
      card.appendChild(lead);
      if (rest) {
        const more = p(rest);
        more.id = 'blp-upgrade-more';
        more.hidden = true;
        const btn = h(
          'button',
          {
            class: 'link-btn',
            type: 'button',
            'aria-expanded': 'false',
            'aria-controls': more.id,
            onclick: () => {
              const open = more.hidden;
              more.hidden = !open;
              btn.setAttribute('aria-expanded', String(open));
              btn.textContent = open ? 'Show less' : 'Read more';
            },
          },
          'Read more',
        );
        lead.append(' ', btn);
        card.appendChild(more);
      }
      if (w.quantitative?.length) {
        card.appendChild(h('ul', { class: 'numbers' }, ...w.quantitative.slice(0, this.depth === 'specialist' ? 8 : 3).map((q) => h('li', null, rich(stripRefs(q))))));
      }
      body.appendChild(card);
    }
    const params = b.keyParameters?.slice(0, 6) ?? [];
    if (params.length) {
      body.appendChild(
        h(
          'div',
          { class: 'param-grid' },
          ...params.map((k) => h('div', { class: 'param' }, h('div', { class: 'param-label' }, k.label), h('div', { class: 'param-value mono' }, k.value))),
        ),
      );
    }
    if (b.funFacts?.length) {
      body.appendChild(h('section', { class: 'facts' }, h('div', { class: 'kicker' }, 'Did you know?'), ...b.funFacts.slice(0, 3).map((f) => p(stripRefs(f)))));
    }
  }

  /** Switch tab from a button inside the panel; focus follows to the newly selected tab. */
  private openTab(t: PanelTab): void {
    this.focusIntent = { kind: 'tab' };
    this.setTab(t);
    this.focusIntent = null;
  }

  private renderHow(b: Beamline, meta: BeamlineMeta): void {
    const body = this.body;
    const id = meta.explainers[0];
    const stationHost = h('div', { class: 'station-host' });
    const head = h('div', { class: 'station-head' });
    this.techHost = h('div', { class: 'techniques' });
    body.append(head, stationHost, this.techHost);
    this.fillTechniques(b);
    const load = () => {
      stationHost.replaceChildren(h('div', { class: 'station-loading' }, 'Loading interactive station…'));
      const token = ++this.explainerToken;
      void loadExplainer(id).then((mod) => {
        if (token !== this.explainerToken) return;
        if (!mod) {
          stationHost.replaceChildren(
            h('div', { class: 'station-loading station-fail' }, h('p', null, 'This station could not load.'), h('button', { class: 'btn', type: 'button', onclick: load }, 'Retry')),
          );
          return;
        }
        head.replaceChildren(
          h('div', { class: 'kicker' }, icon('beaker', 14), ' Interactive station'),
          h('h3', { class: 'station-title' }, mod.title),
          h('p', { class: 'station-sub' }, mod.subtitle),
          h('button', { class: 'btn btn-ghost station-expand', type: 'button', onclick: () => this.onExpandExplainer(id), title: 'Open full screen' }, icon('expand', 15), 'Full screen'),
        );
        stationHost.replaceChildren();
        this.explainer = mod.mount(stationHost, { depth: this.depth, color: meta.color, beamlineId: b.id });
      });
    };
    load();
  }

  private fillTechniques(b: Beamline): void {
    this.techHost?.replaceChildren(
      ...(b.techniques ?? []).map((t) =>
        h('section', { class: 'technique' }, h('h4', null, t.name, t.abbrev ? h('span', { class: 'abbr' }, ` ${t.abbrev}`) : null), p(this.txt(t.plain, t.expert))),
      ),
    );
  }

  /** Stops in pin order (the 3D pins number the same list). */
  private stops(b: Beamline): BeamlineComponent[] {
    return b.components.filter((c) => c.distanceM !== null && c.distanceM !== undefined && !this.hiddenIds.has(c.id));
  }

  private renderInside(b: Beamline): void {
    const body = this.body;
    const comps = this.stops(b);
    const idx = this.componentId ? comps.findIndex((c) => c.id === this.componentId) : -1;
    if (idx >= 0) {
      body.appendChild(this.componentCard(b, comps[idx], idx, comps));
      return;
    }
    body.appendChild(
      h(
        'p',
        { class: 'muted' },
        'Follow the X-rays from the undulator source to the detector. Pick any stop to fly the camera there; distances are measured from the source point.',
      ),
    );
    if (b.geometryNotes && this.depth === 'specialist') body.appendChild(p(b.geometryNotes, 'muted small'));
    const list = h('ol', { class: 'stop-list' });
    const branchName = new Map((b.branches ?? []).map((x) => [x.id, x.name]));
    const groups: [string | null, number[]][] = [];
    if ((b.branches?.length ?? 0) > 1) {
      // Shared source & optics first, then each branch in its own run. Undulators always sit with the shared source:
      // even canted ones share the straight section and front end, whichever branch their beam feeds.
      const groupOf = (c: BeamlineComponent) => (c.category === 'undulator' ? null : (c.branch ?? null));
      const keys: (string | null)[] = [null, ...(b.branches ?? []).map((x) => x.id)];
      for (const k of keys) {
        const ii = comps.map((c, i) => [c, i] as const).filter(([c]) => groupOf(c) === k).map(([, i]) => i);
        if (ii.length) groups.push([k, ii]);
      }
      body.appendChild(h('p', { class: 'small muted stop-note' }, 'Stops are numbered by distance along the beam, the same numbers as the pins in 3D, so each branch list skips the numbers that belong to the others.'));
    } else groups.push([null, comps.map((_, i) => i)]);
    const describedEnc = new Set<string>();
    for (const [key, idxs] of groups) {
      if (groups.length > 1) list.appendChild(h('li', { class: 'stop-branch' }, key ? branchName.get(key) ?? key : 'Shared source & optics'));
      let lastEnc = '';
      for (const i of idxs) {
        const c = comps[i];
        if (c.enclosure && c.enclosure !== lastEnc) {
          lastEnc = c.enclosure;
          const enc = b.enclosures.find((e) => e.name === c.enclosure);
          // describe each enclosure once; later branch groups repeat only its name
          const role = enc && !describedEnc.has(enc.name) ? enc.role : '';
          describedEnc.add(c.enclosure);
          list.appendChild(
            h('li', { class: 'stop-enc' }, h('span', { class: 'stop-enc-name mono' }, c.enclosure), role ? h('span', { class: 'stop-enc-role', title: sentenceCase(role) }, firstClause(role)) : null),
          );
        }
        const feeds = groups.length > 1 && key === null && c.branch ? branchName.get(c.branch) : undefined;
        list.appendChild(
          h(
            'li',
            { class: 'stop' },
            h(
              'button',
              { class: 'stop-btn', type: 'button', dataset: { id: c.id }, onclick: () => this.go(c.id, { kind: 'title' }) },
              h('span', { class: 'stop-num' }, String(i + 1)),
              h('span', { class: 'stop-ico' }, categoryIcon(componentKindKey(c))),
              h('span', { class: 'stop-name' }, c.name, feeds ? h('span', { class: 'stop-feeds' }, `feeds ${feeds}`) : null),
              h('span', { class: 'stop-dist mono' }, formatDist(c.distanceM)),
            ),
          ),
        );
      }
    }
    body.appendChild(list);
    if (b.instruments?.length) {
      body.appendChild(h('h4', { class: 'sub' }, 'End stations & instruments'));
      for (const ins of b.instruments) {
        body.appendChild(
          h(
            'section',
            { class: 'technique' },
            h('h4', null, ins.name, ins.enclosure ? h('span', { class: 'abbr mono' }, ` ${ins.enclosure}`) : null),
            p(this.txt(ins.plain, ins.expert)),
            this.depth === 'specialist' && ins.detectors?.length ? h('div', { class: 'small muted' }, h('b', null, 'Detectors: '), ins.detectors.join('; ')) : null,
            this.depth === 'specialist' && ins.sampleEnvironments?.length ? h('div', { class: 'small muted' }, h('b', null, 'Sample environments: '), ins.sampleEnvironments.join('; ')) : null,
          ),
        );
      }
    }
  }

  private componentCard(b: Beamline, c: BeamlineComponent, idx: number, comps: BeamlineComponent[]): HTMLElement {
    const ref = c.source ? b.references.find((r) => r.id === c.source) : undefined;
    const specs = Object.entries(c.specs ?? {});
    const enc = c.enclosure ? b.enclosures.find((e) => e.name === c.enclosure) : undefined;
    const prev = comps[idx - 1];
    const next = comps[idx + 1];
    return h(
      'article',
      { class: 'comp-card', 'aria-labelledby': 'blp-comp-title' },
      h(
        'div',
        { class: 'comp-nav' },
        h('button', { class: 'btn btn-ghost', type: 'button', onclick: () => this.go(null, { kind: 'stop', id: c.id }) }, icon('back', 15), 'All stops'),
        h('span', { class: 'flex1' }),
        h('button', { class: 'btn btn-ghost btn-icon', type: 'button', disabled: !prev, 'aria-label': 'Previous component (upstream)', title: 'Upstream ( [ )', onclick: () => prev && this.go(prev.id, { kind: 'title' }) }, icon('back', 15)),
        h('span', { class: 'mono small muted' }, `${idx + 1} / ${comps.length}`),
        h('button', { class: 'btn btn-ghost btn-icon', type: 'button', disabled: !next, 'aria-label': 'Next component (downstream)', title: 'Downstream ( ] )', onclick: () => next && this.go(next.id, { kind: 'title' }) }, icon('next', 15)),
      ),
      h('div', { class: 'comp-kind' }, categoryIcon(componentKindKey(c)), ' ', componentKind(c)),
      h('h3', { class: 'comp-title', id: 'blp-comp-title', tabindex: '-1' }, c.name),
      h(
        'div',
        { class: 'comp-meta' },
        h('span', { class: 'chip mono' }, icon('ruler', 13), ` ${formatDist(c.distanceM)} from source`),
        c.enclosure ? h('span', { class: 'chip mono', title: enc?.role ?? '' }, c.enclosure) : null,
        c.deflection && c.deflection !== 'none' ? h('span', { class: 'chip' }, `${c.deflection} deflection`) : null,
      ),
      p(c.plain, this.depth === 'specialist' ? 'muted' : ''),
      this.depth === 'specialist' && c.expert ? p(c.expert) : !c.expert ? null : h('details', { class: 'more' }, h('summary', null, 'For specialists'), p(c.expert)),
      specs.length
        ? h('table', { class: 'specs' }, h('tbody', null, ...specs.map(([k, v]) => h('tr', null, h('th', { scope: 'row' }, specLabelNode(k)), h('td', { class: 'mono' }, String(v))))))
        : null,
      c.distanceNote && this.depth === 'specialist' ? p(`Position: ${c.distanceNote}`, 'small muted') : null,
      ref ? h('div', { class: 'src small' }, icon('doc', 13), ' Source: ', refLink(ref)) : null,
    );
  }

  private renderScience(b: Beamline): void {
    const body = this.body;
    for (const s of b.scienceCases ?? []) {
      const refs = (s.refs ?? []).map((id) => b.references.find((r) => r.id === id)).filter(Boolean) as Reference[];
      body.appendChild(
        h(
          'section',
          { class: 'science' },
          h('h4', null, s.title),
          p(this.txt(s.plain, s.expert)),
          refs.length
            ? h('div', { class: 'src small' }, icon('doc', 13), h('ul', { class: 'ref-list', 'aria-label': 'Sources' }, ...refs.map((r) => h('li', null, refLink(r)))))
            : null,
        ),
      );
    }
  }

  private renderSpecs(b: Beamline, meta: BeamlineMeta): void {
    const body = this.body;
    const visitor = this.depth === 'visitor';
    if (visitor) body.appendChild(p('These are the engineering details beamline scientists care about. Switch to **Specialist** (top right) for denser explanations everywhere.', 'muted small'));
    body.appendChild(h('h4', { class: 'sub' }, 'Key parameters'));
    const row = (label: string, value: string, note?: string, prose = false) =>
      h('tr', null, h('th', { scope: 'row' }, label), h('td', { class: prose ? undefined : 'mono' }, value, note ? h('div', { class: 'small muted spec-note' }, note) : null));
    body.appendChild(
      h(
        'table',
        { class: 'specs' },
        h(
          'tbody',
          null,
          row('Full title', b.fullName, undefined, true),
          row('Sector & stations', `${meta.sectorNumber}-ID${meta.stations ? ` · ${meta.stations}` : ''}`),
          ...(b.keyParameters ?? []).map((k) => row(k.label, k.value, k.note && !(visitor && INTERNAL_NOTE.test(k.note)) ? k.note : undefined)),
        ),
      ),
    );
    const ids = b.source?.insertionDevices ?? [];
    if (ids.length) {
      body.appendChild(h('h4', { class: 'sub' }, 'Source'));
      for (const d of ids) {
        body.appendChild(
          h(
            'div',
            { class: 'src-card' },
            h('b', null, d.name),
            h('div', { class: 'small' }, d.type),
            h(
              'div',
              { class: 'mono small muted' },
              [d.periodMm ? `λu = ${d.periodMm} mm` : '', d.lengthM ? `L = ${d.lengthM} m` : '', d.count && d.count > 1 ? `×${d.count}` : '', d.polarization ?? '']
                .filter(Boolean)
                .join(' · '),
            ),
            d.notes && !(visitor && INTERNAL_NOTE.test(d.notes)) ? p(d.notes, 'small muted') : null,
          ),
        );
      }
      if (b.source.canting) body.appendChild(p(`**Canting:** ${b.source.canting}`, 'small'));
      if (b.source.frontEnd) body.appendChild(p(`**Front end:** ${b.source.frontEnd}`, 'small'));
      if (b.source.sourceSizeAndDivergence) body.appendChild(p(`**Source size:** ${b.source.sourceSizeAndDivergence}`, 'small'));
    }
    if (b.enclosures?.length) {
      body.appendChild(h('h4', { class: 'sub' }, 'Enclosures'));
      body.appendChild(
        h(
          'table',
          { class: 'specs' },
          h('tbody', null, ...b.enclosures.map((e) => h('tr', null, h('th', { class: 'mono', scope: 'row' }, e.name), h('td', null, sentenceCase(e.role), h('div', { class: 'mono small muted' }, `${fmt(e.startM)}–${fmt(e.endM)} m`))))),
        ),
      );
    }
    if (b.figures?.length) {
      body.appendChild(h('h4', { class: 'sub' }, 'From the design record'));
      for (const f of b.figures) {
        const ref = f.source ? b.references.find((r) => r.id === f.source) : undefined;
        const src = `figures/${f.file.replace(/^figs\//, '')}`;
        const short = shortCaption(f.caption);
        body.appendChild(
          h(
            'figure',
            { class: 'record' },
            h(
              'button',
              { class: 'record-zoom', type: 'button', 'aria-label': `Enlarge figure: ${short}`, title: 'Enlarge', onclick: () => this.openFigure(f, src, short, ref) },
              // the caption below describes the figure, so the image itself stays silent
              h('img', { src, alt: '', loading: 'lazy' }),
              h('span', { class: 'record-zoom-hint', 'aria-hidden': 'true' }, icon('expand', 14)),
            ),
            h(
              'figcaption',
              null,
              rich(f.caption),
              this.depth === 'specialist' && f.whatItShows ? h('div', { class: 'small muted' }, rich(f.whatItShows)) : null,
              ref ? h('div', { class: 'small muted' }, 'Credit: ', refLink(ref), f.page ? `, p. ${f.page}` : '') : null,
            ),
          ),
        );
      }
    }
    if (b.openQuestions?.length && this.depth === 'specialist') {
      body.appendChild(h('h4', { class: 'sub' }, 'Caveats & open questions'));
      body.appendChild(h('ul', { class: 'small muted' }, ...b.openQuestions.map((q) => h('li', null, q))));
    }
    body.appendChild(h('h4', { class: 'sub' }, 'References'));
    body.appendChild(h('ol', { class: 'refs small' }, ...b.references.map((r) => h('li', { id: `ref-${b.id}-${r.id}` }, refLink(r), r.venue ? h('span', { class: 'muted' }, ` — ${r.venue}${r.year ? `, ${r.year}` : ''}`) : null))));
  }

  private openFigure(f: Figure, src: string, short: string, ref: Reference | undefined): void {
    const content: Node[] = [
      h('div', { class: 'kicker' }, `${this.b?.acronym ?? ''} · From the design record`),
      h(
        'figure',
        { class: 'fig-zoom' },
        h('img', { src, alt: `Figure: ${short}` }),
        h(
          'figcaption',
          null,
          rich(f.caption),
          f.whatItShows ? h('div', { class: 'small muted' }, rich(f.whatItShows)) : null,
          h(
            'div',
            { class: 'small muted' },
            ref ? ['Credit: ', refLink(ref), f.page ? `, p. ${f.page}` : '', ' · '] : null,
            h('a', { href: src, target: '_blank', rel: 'noopener' }, 'Open the full-resolution image'),
          ),
        ),
      ),
    ];
    this.onOpenFigure(content, `Figure: ${short}`, src);
  }

  private destroyExplainer(): void {
    this.explainerToken++;
    this.explainer?.destroy();
    this.explainer = null;
  }
}

export function refLink(r: Reference): HTMLElement {
  const label = r.title || r.url || r.id;
  return r.url ? h('a', { href: r.url, target: '_blank', rel: 'noopener' }, label) : h('span', null, label);
}

export function formatDist(d: number | null | undefined): string {
  if (d === null || d === undefined) return '—';
  return d < 10 ? `${d.toFixed(1)} m` : `${d.toFixed(1).replace(/\.0$/, '')} m`;
}

const fmt = (x: number) => (Number.isFinite(x) ? x.toFixed(1).replace(/\.0$/, '') : '?');

/** Research strings carry "(r3)" style citations; the panel shows sources separately. */
export function stripRefs(s: string): string {
  return s.replace(/\s*\((?:r\d+[a-z]?(?:[,;]\s*)?)+\)/g, '').replace(/\s*\[(?:r\d+[a-z]?(?:[,;]\s*)?)+\]/g, '');
}

const sentenceCase = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** Identity of a focusable control that survives a re-render (stop id, element id, or its label). */
interface FocusSig {
  tag: string;
  id: string;
  label: string;
}
function focusSig(el: HTMLElement): FocusSig {
  return { tag: el.tagName.toLowerCase(), id: el.dataset.id || el.id, label: (el.getAttribute('aria-label') ?? el.textContent ?? '').trim().slice(0, 80) };
}
const sameSig = (a: FocusSig, b: FocusSig) => a.tag === b.tag && a.id === b.id && a.label === b.label;

/**
 * First clause of an enclosure role ("first optics enclosure (white beam): FE exit mask, …" → "First optics enclosure
 * (white beam)"): text up to the first top-level ':', ';' or ' - ' (never inside parentheses), shortened at a top-level
 * comma or before a parenthetical when still long.
 */
export function firstClause(s: string, max = 84): string {
  const cuts: number[] = [];
  let depth = 0;
  let end = s.length;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '(') {
      if (depth === 0 && s[i - 1] === ' ') cuts.push(i - 1);
      depth++;
    } else if (ch === ')') depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (((ch === ':' || ch === ';') && /\s/.test(s[i + 1] ?? ' ')) || (/[-–—]/.test(ch) && s[i - 1] === ' ' && s[i + 1] === ' ')) {
        end = i;
        break;
      }
      if (ch === ',' && s[i + 1] === ' ') cuts.push(i);
    }
  }
  let out = s.slice(0, end).trim();
  if (out.length > max) {
    const cut = cuts.filter((c) => c > 12 && c <= max).pop();
    out = cut !== undefined ? out.slice(0, cut) : `${out.slice(0, max).replace(/\s+\S*$/, '')}…`;
  }
  return sentenceCase(out.trim());
}

/** Split off the first sentence (at least 40 characters, so "e.g." or "approx." early on do not end it). */
export function splitFirstSentence(s: string): [string, string] {
  const m = /^(.{40,}?[.!?])\s+(?=[A-Z0-9“"‘'(])/s.exec(s);
  return m ? [m[1], s.slice(m[0].length)] : [s, ''];
}

/** A short accessible title for a figure: its caption up to the first colon or full stop. */
function shortCaption(caption: string): string {
  const plain = caption.replace(/[*`]/g, '').replace(/[_^]\{(.+?)\}/g, '$1');
  const first = plain.split(/[:.](?:\s|$)/)[0].trim();
  return first.length > 90 ? `${first.slice(0, 88).replace(/\s+\S*$/, '')}…` : first;
}

// ---------------------------------------------------------------- spec labels

/** Whole keys that the generic rules below would get wrong (or that read better spelled out). */
const SPEC_KEY: Record<string, string> = {
  E1: 'E_{1} (first harmonic)',
  E1atMinGap: 'E_{1} at minimum gap',
  Ptot200mA: 'Total power at 200 mA',
  Pc: 'Circular polarization P_{c}',
  Plin: 'Linear polarization P_{lin}',
  T: 'Temperature',
  f: 'Focal length',
  NA: 'Numerical aperture',
  WD: 'Working distance',
  q1: 'Image distance q_{1}',
  dof: 'Degrees of freedom',
  DOF_5nm_10keV_um: 'Depth of focus, 5 nm zone plate at 10 keV (µm)',
  ideal5nmZP_10keV: 'Ideal 5 nm zone plate at 10 keV',
  ideal20nmZP_10keV: 'Ideal 20 nm zone plate at 10 keV',
  sample2D_mm: 'Sample size, 2D (mm)',
  sample3D_mmDiameter: 'Sample size, 3D (mm diameter)',
  energyRange_keV_Si: 'Energy range, Si sensor (keV)',
  twoTheta_deg: '2θ (°)',
  dE_over_E: 'ΔE/E',
  dSpacing_A: 'd-spacing (Å)',
  Hmirror: 'Horizontal mirror',
  Vmirror: 'Vertical mirror',
  chiRange: 'χ range',
  AC_H_um: 'AC resolution, horizontal (µm)',
  AC_V_um: 'AC resolution, vertical (µm)',
  resolutionAC_um: 'AC resolution (µm)',
  resolutionDC_um: 'DC resolution (µm)',
  sampleDetectorDistance_m: 'Sample-to-detector distance (m)',
  powerM1: 'Power on M1',
  analyser_published: 'Analyser (published system)',
  heritageTheta: 'θ rotation (pre-upgrade stack)',
  heritagePiezo: 'Piezo stage (pre-upgrade stack)',
  heritageLogging_kHz: 'Logging rate, heritage system (kHz)',
};

/** The leading camelCase part of a key ("maxLenses_D" → "maxLenses"), where the word rules read poorly. */
const SPEC_BASE: Record<string, string> = {
  maxLenses: 'maximum number of lenses',
};

/** Single words inside a key (matched case-insensitively). */
const SPEC_WORD: Record<string, string> = {
  max: 'maximum',
  min: 'minimum',
  approx: 'approximate',
  demag: 'demagnification',
  keff: 'K_{eff}',
  e1: 'E_{1}',
  ptot: 'total power',
  pdens: 'power density',
  cufe: 'CuFE',
  fdr: 'FDR',
  zp: 'zone-plate',
  haxpes: 'HAXPES',
  theta: 'θ',
  chi: 'χ',
};

const SPEC_UNIT: Record<string, string> = {
  um: 'µm',
  nm: 'nm',
  mm: 'mm',
  m: 'm',
  km: 'km',
  keV: 'keV',
  kW: 'kW',
  W: 'W',
  mA: 'mA',
  mrad: 'mrad',
  urad: 'µrad',
  deg: '°',
  kHz: 'kHz',
  MB: 'MB',
  A: 'Å',
};

/** Unit suffixes spelled with underscores ("_W_per_mm2", "_ph_s"), longest first. */
const SPEC_COMPOUND_UNIT: [RegExp, string][] = [
  [/_kW_per_mrad2(?=_|$)/, 'kW/mrad²'],
  [/_W_per_mm2(?=_|$)/, 'W/mm²'],
  [/_ph_s_px(?=_|$)/, 'ph/s/pixel'],
  [/_ph_s(?=_|$)/, 'ph/s'],
  [/_GB_s(?=_|$)/, 'GB/s'],
  [/_mm_s(?=_|$)/, 'mm/s'],
];

const isAcronym = (w: string) => /^[A-Z][A-Z0-9]+s?$/.test(w) || /^[A-Z]$/.test(w) || /\d/.test(w);

function words(seg: string): string[] {
  return seg
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z]{2,})/g, '$1 $2')
    .replace(/(\d)([A-Z][a-z])/g, '$1 $2')
    .replace(/([a-z]{2,})(\d)/g, '$1 $2')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => SPEC_WORD[w.toLowerCase()] ?? (isAcronym(w) ? w : w.toLowerCase()));
}

/**
 * Readable label for a component spec key from the research dossiers: "E1_atMinGap_keV" → "E₁ at minimum gap (keV)",
 * "designPowerDensity_W_per_mm2" → "Design power density (W/mm²)", "flux_15keV_ph_s" → "Flux at 15 keV (ph/s)".
 * Keys that already contain spaces are written for people and come back unchanged. The result may use the panel's
 * `_{sub}` markup (rendered by `rich`).
 */
export function specLabel(key: string): string {
  if (/\s/.test(key)) return key;
  if (SPEC_KEY[key]) return SPEC_KEY[key];
  if (!/^[A-Za-z0-9_]+$/.test(key)) return /^[a-z][a-z-]*$/.test(key) ? sentenceCase(key) : key;
  let k = key;
  let unit = '';
  for (const [re, u] of SPEC_COMPOUND_UNIT) {
    if (re.test(k)) {
      unit = u;
      k = k.replace(re, '');
      break;
    }
  }
  const segs = k.split('_').filter(Boolean);
  let base = segs.shift() ?? key;
  if (!unit) {
    // a unit may sit in any later segment ("E1_keV_atMinGap")
    const ui = segs.findIndex((s) => SPEC_UNIT[s] !== undefined);
    if (ui >= 0) unit = SPEC_UNIT[segs.splice(ui, 1)[0]];
  }
  if (!unit) {
    // camelCase unit suffix: "periodMm", "magneticLengthM"
    const m = /^(.*[a-z])(Mm|M)$/.exec(base);
    if (m) {
      base = m[1];
      unit = m[2] === 'Mm' ? 'mm' : 'm';
    }
  }
  // "focus H" → "horizontal focus"
  let label = (SPEC_BASE[base] ?? words(base).join(' ')).replace(/^(.+) ([HV])$/, (_m, rest: string, hv: string) => `${hv === 'H' ? 'horizontal' : 'vertical'} ${rest}`);
  for (const s of segs) {
    const q = /^(\d+(?:\.\d+)?)([A-Za-z]+)$/.exec(s);
    if (q && SPEC_UNIT[q[2]]) {
      const v = `${q[1]} ${SPEC_UNIT[q[2]]}`;
      label += q[2] === 'keV' || q[2] === 'mA' ? ` at ${v}` : `, ${v}`;
    } else if (/^at[A-Z]/.test(s)) label += ` ${words(s).join(' ')}`;
    else if (s === 'H' || s === 'V') label += s === 'H' ? ', horizontal' : ', vertical';
    else label += `, ${words(s).join(' ')}`;
  }
  return sentenceCase(label) + (unit ? ` (${unit})` : '');
}

/** The spec label as a node (formatted keys may carry sub/superscripts; keys written for people stay plain text). */
export function specLabelNode(key: string): Node {
  const label = specLabel(key);
  return label === key ? document.createTextNode(key) : rich(label);
}
