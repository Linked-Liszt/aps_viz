import { h, icon, nodes, p, rich } from '../lib/dom';
import { store, type Depth } from '../app/store';
import { Modal, depthToggle, holdExclusive, loadErrorNotice, mountStation } from './Modal';
import { loadExplainer } from './explainers/registry';
import { FACILITY, type Param } from '../data/facility';
import { TOUR, type TourStep } from '../data/tour';
import { mats } from '../scene/palette';

/** Touch-first device (kiosk, tablet, phone): gesture hints say drag / pinch instead of right-drag / scroll. */
const coarsePointer = (): boolean => typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

/** Research notation → exhibit typography (prose and labels). */
function typo(s: string): string {
  return s
    .replace(/\+\/-/g, '±')
    .replace(/\burad\b/g, 'µrad')
    .replace(/\bum\b/g, 'µm')
    .replace(/\bpm[ .]rad\b/g, 'pm·rad')
    .replace(/\bnm[ .]rad\b/g, 'nm·rad');
}

// ------------------------------------------------------------------ intro

export function buildIntro(onExplore: () => void, onTour: () => void): HTMLElement {
  const touch = coarsePointer();
  const primary = h('button', { class: 'btn btn-primary btn-lg', onclick: () => onTour() }, icon('tour', 17), 'Start the guided tour');
  const hints: [string, string][] = touch
    ? [
        ['Drag', ' to orbit'],
        ['Two-finger drag', ' to pan'],
        ['Pinch', ' to zoom'],
        ['Tap', ' a glowing beamline to enter'],
      ]
    : [
        ['Drag', ' to orbit'],
        ['Right-drag', ' to pan'],
        ['Scroll', ' to zoom'],
        ['Click', ' a glowing beamline to enter'],
      ];
  const el = h(
    'div',
    { class: 'intro', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'intro-title', 'aria-describedby': 'intro-lede' },
    h(
      'div',
      { class: 'intro-card' },
      h('div', { class: 'kicker' }, 'An interactive exhibit'),
      h('h1', { class: 'intro-title', id: 'intro-title' }, 'The Advanced Photon Source,', h('br'), h('span', { class: 'grad' }, 'upgraded.')),
      h(
        'p',
        { class: 'intro-lede', id: 'intro-lede' },
        'A kilometre-long ring of electrons now makes X-rays about 500 times brighter than before. Fly over the facility, step inside the nine new feature beamlines, and play with the physics that each one uses to see the invisible.',
      ),
      h('div', { class: 'cta-row' }, primary, h('button', { class: 'btn btn-lg', onclick: () => onExplore() }, icon('ring', 17), 'Explore freely')),
      h('div', { class: 'intro-hints small' }, ...hints.map(([k, v]) => h('span', null, h('b', null, k), v))),
      h(
        'p',
        { class: 'intro-fine small muted' },
        'Independent educational visualization built from public APS / Argonne documents and peer-reviewed publications (sources listed for every beamline). Not an official APS product. Hutch geometry for non-feature sectors is schematic.',
      ),
    ),
  );
  // The app shows and dismisses the intro by toggling `is-open`: while it is shown, nothing behind it is reachable.
  let release: (() => void) | null = null;
  const watch = new MutationObserver(() => {
    const open = el.classList.contains('is-open');
    if (open && !release) {
      release = holdExclusive(el);
      primary.focus({ preventScroll: true });
    } else if (!open && release) {
      release();
      release = null;
      watch.disconnect();
    }
  });
  watch.observe(el, { attributes: true, attributeFilter: ['class'] });
  return el;
}

// ------------------------------------------------------------------ "The upgrade" story

const STORY_TABS: { id: string; label: string }[] = [
  { id: 'primer', label: 'Primer' },
  { id: 'mba', label: 'A new kind of ring' },
  { id: 'brightness', label: 'Brightness' },
  { id: 'undulator', label: 'Undulators' },
  { id: 'coherence', label: 'Coherence' },
  { id: 'numbers', label: 'By the numbers' },
  { id: 'timeline', label: 'Timeline' },
];

const PRIMER: [string, string][] = [
  ['whatIsSynchrotron', 'What is a synchrotron light source?'],
  ['whatIsUndulator', 'What is an undulator?'],
  ['whatIsMBA', 'What is a multi-bend achromat?'],
  ['whyEmittanceMatters', 'Why does emittance matter?'],
  ['whatIsCoherence', 'What is coherence?'],
  ['whatIsSwapOut', 'What is swap-out injection?'],
  ['whatIsBunchLengthening', 'Why stretch the bunches?'],
  ['whyLowerEnergy', 'Why run at 6 GeV instead of 7?'],
  ['whyRoundBeams', 'Why a round beam?'],
];

function primer(): HTMLElement {
  const ex = FACILITY.plainExplainers ?? {};
  return h(
    'div',
    { class: 'primer' },
    ...PRIMER.filter(([k]) => ex[k]).map(([k, title], i) => h('details', { class: 'primer-item', open: i === 0 }, h('summary', null, title), p(ex[k]))),
  );
}

type P = Param | undefined;

const fmtNum = (v: number) => v.toLocaleString('en-US', { maximumFractionDigits: 3 });
/** Unit string of a parameter without qualifiers: 'um rms' → 'µm', 'pm rad (each plane)' → 'pm·rad'. */
const unitOf = (x: P) => typo((x?.unit ?? '').replace(/\s*\(.*\)\s*$/, '').replace(/\s*\brms\b/, '').trim()).replace(/^-$/, '');
const valOf = (x: P) => (x === undefined ? '' : typeof x.value === 'number' ? fmtNum(x.value) : String(x.value));
const one = (x: P) => (x ? `${valOf(x)} ${unitOf(x)}`.trim() : '');
/** 'a × b unit', kept on one line */
const pair = (a: string | undefined, b: string | undefined, unit: string) => (a && b ? `${a}\u00a0×\u00a0${b}${unit ? `\u00a0${unit}` : ''}` : '');
/** '28 +/- 3 (h), 31 +/- 2 (v)' → { h: '28', v: '31' } (or '28 ± 3' with errors). */
function planes(x: P, withErr = false): { h?: string; v?: string } {
  const out: { h?: string; v?: string } = {};
  for (const m of String(x?.value ?? '').matchAll(/([\d.,]+)\s*(?:\+\/-\s*([\d.,]+))?\s*\((h|v)\)/g)) {
    out[m[3] as 'h' | 'v'] = withErr && m[2] ? `${m[1]} ± ${m[2]}` : m[1];
  }
  return out;
}
const round = (x: P) => (typeof x?.value === 'number' ? fmtNum(Math.round(x.value)) : undefined);

/**
 * The ring before and after. The APS-U column is what users get: the round-beam (full-coupling) user mode;
 * the flat, low-coupling mode is given underneath.
 */
function compareTable(depth: Depth): HTMLElement {
  const specialist = depth === 'specialist';
  const B = (FACILITY.ring?.before ?? {}) as Record<string, Param>;
  const A = (FACILITY.ring?.after ?? {}) as Record<string, Param>;
  const roundEmit = planes(A.emittanceMeasuredRound);
  const roundErr = planes(A.emittanceMeasuredRound, true);
  const roundDiv = planes(A.divergenceAtID_round);
  const magnetsAfter = /^[\d,]+/.exec(FACILITY.exhibitNumbers?.find((n) => n.label === 'Magnets')?.value ?? '')?.[0];
  const rows: [label: string, note: string, before: string, after: string][] = [
    ['Electron energy', '', one(B.beamEnergy), one(A.beamEnergy)],
    ['Stored current', '', one(B.beamCurrent), one(A.beamCurrent)],
    [
      'Emittance (design, horizontal)',
      specialist ? 'APS: effective emittance; APS-U: natural emittance of the new lattice' : 'APS-U value: natural emittance, about 75× smaller',
      one(B.horizontalEmittance),
      one(A.naturalEmittance),
    ],
    [
      'Emittance in user operation (h × v)',
      specialist && roundErr.h && roundErr.v
        ? `APS-U: measured in the round-beam (full-coupling) user mode, 2024: ${roundErr.h} (h), ${roundErr.v} (v)`
        : 'APS-U: measured in the round-beam user mode (2024)',
      pair(valOf(B.horizontalEmittance), valOf(B.verticalEmittance), unitOf(B.horizontalEmittance)),
      pair(roundEmit.h, roundEmit.v, unitOf(A.emittanceMeasuredRound)),
    ],
    [
      'Beam size at an undulator (h × v, rms)',
      specialist ? 'APS-U: round-beam mode, zero-current model' : 'APS-U: round-beam user mode',
      pair(valOf(B.horizontalBeamSizeAtID), valOf(B.verticalBeamSizeAtID), unitOf(B.horizontalBeamSizeAtID)),
      pair(valOf(A.horizontalBeamSizeAtID_round), valOf(A.verticalBeamSizeAtID_round), unitOf(A.horizontalBeamSizeAtID_round)),
    ],
    [
      'Beam divergence (h × v, rms)',
      '',
      pair(valOf(B.horizontalDivergenceAtID), valOf(B.verticalDivergenceAtID), unitOf(B.horizontalDivergenceAtID)),
      pair(roundDiv.h, roundDiv.v, unitOf(A.divergenceAtID_round)),
    ],
    ['Circumference', '', one(B.circumference), one(A.circumference)],
    ['Magnets', '', one(B.magnets), magnetsAfter ? `${magnetsAfter} magnets` : ''],
    ['RF frequency', '', one(B.rfFrequency), one(A.rfFrequency)],
  ];
  const flatEmit = planes(A.emittanceMeasuredFlat, true);
  const flat = specialist
    ? `**Flat (low-coupling, κ = 0.1) mode:** emittance ${pair(valOf(A.horizontalEmittanceFlatModel), valOf(A.verticalEmittanceFlatModel), unitOf(A.horizontalEmittanceFlatModel))} (model${flatEmit.h && flatEmit.v ? `; measured ${flatEmit.h} (h), ${flatEmit.v} (v)` : ''}), beam ${pair(valOf(A.horizontalBeamSizeAtID_flat), valOf(A.verticalBeamSizeAtID_flat), unitOf(A.horizontalBeamSizeAtID_flat))}, divergence ${pair(valOf(A.horizontalDivergenceAtID_flat), valOf(A.verticalDivergenceAtID_flat), unitOf(A.horizontalDivergenceAtID_flat))} rms. Round-mode sizes and divergences are zero-current model values (κ = 1).`
    : `Users normally get the round beam shown here. A flat, low-coupling mode is also possible: about ${pair(round(A.horizontalEmittanceFlatModel), round(A.verticalEmittanceFlatModel), unitOf(A.horizontalEmittanceFlatModel))} emittance and a ${pair(valOf(A.horizontalBeamSizeAtID_flat), valOf(A.verticalBeamSizeAtID_flat), unitOf(A.horizontalBeamSizeAtID_flat))} beam.`;
  return h(
    'div',
    { class: 'compare-wrap' },
    h(
      'table',
      { class: 'specs compare' },
      h('caption', { class: 'sr-only' }, 'The storage ring before and after the upgrade'),
      h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Parameter')), h('th', { scope: 'col' }, 'APS (as last operated, 2023)'), h('th', { scope: 'col' }, 'APS-U (user mode, 2024–)'))),
      h(
        'tbody',
        null,
        ...rows
          .filter(([, , b, a]) => b || a)
          .map(([label, note, b, a]) =>
            h('tr', null, h('th', { scope: 'row' }, label, note ? h('div', { class: 'small muted' }, note) : null), h('td', { class: 'mono' }, b || '—'), h('td', { class: 'mono hl' }, a || '—')),
          ),
      ),
    ),
    p(flat, 'small muted compare-note'),
  );
}

function numbers(depth: Depth): HTMLElement {
  const visitor = depth === 'visitor';
  const cards = (FACILITY.exhibitNumbers ?? []).map((n) => {
    const exp = (visitor && n.plain) || n.explanation;
    return h(
      'div',
      { class: 'num-card' },
      h('div', { class: 'num-label' }, rich(typo(n.label))),
      h('div', { class: 'num-value' }, rich(typo(n.value))),
      exp ? h('div', { class: 'num-exp small muted' }, rich(typo(exp))) : null,
    );
  });
  return h('div', { class: 'numbers-tab' }, compareTable(depth), h('div', { class: 'num-grid' }, ...cards));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
/** Sort key from the first yyyy[-mm[-dd]] in a (possibly approximate) date such as 'c. 2014' or '2025-09 (late)'. */
const dateKey = (d: string) => /\d{4}(?:-\d{2}){0,2}/.exec(d)?.[0] ?? d;
/**
 * '2024-04-13' → '13 Apr 2024', '2024-08' → 'Aug 2024', '2024-03-25/28' → '25–28 Mar 2024',
 * '2025-09 (late)' → 'Late Sep 2025'; anything else is shown as written.
 */
function friendlyDate(d: string): string {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2})(?:\/(\d{2}))?)?(?:\s*\((early|mid|late)\))?$/.exec(d.trim());
  const mon = m ? MONTHS[Number(m[2]) - 1] : undefined;
  if (!m || !mon) return d;
  const [, y, , day, dayTo, part] = m;
  const days = day ? `${Number(day)}${dayTo ? `–${Number(dayTo)}` : ''} ` : '';
  const when = `${days}${mon} ${y}`;
  return part ? `${part[0].toUpperCase()}${part.slice(1)} ${when}` : when;
}

function timeline(depth: Depth): HTMLElement {
  const items = [...(FACILITY.timeline ?? [])].sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
  if (!items.length) return p('Timeline data unavailable.');
  const specialist = depth === 'specialist';
  return h(
    'ol',
    { class: 'timeline' },
    ...items.map((t) =>
      h(
        'li',
        null,
        h('div', { class: 'tl-date mono' }, specialist ? t.date : friendlyDate(t.date)),
        h('div', { class: 'tl-event' }, rich(typo(specialist || !t.plain ? t.event : t.plain))),
      ),
    ),
  );
}

/** Story tabs rendered from data (no station): re-rendered when the depth changes. */
const STATIC_TABS: Record<string, (d: Depth) => HTMLElement> = {
  primer: () => primer(),
  numbers,
  timeline,
};

export function openStory(modal: Modal, startTab = 'primer'): void {
  let alive = true;
  let seq = 0;
  let current = startTab;
  let destroyStation: (() => void) | null = null;
  const tabs = h('div', { class: 'tab-row story-tabs', role: 'tablist', 'aria-label': 'The upgrade, step by step' });
  const stage = h('div', { class: 'story-stage', role: 'tabpanel', id: 'story-panel' });
  const depth = depthToggle();

  const select = async (id: string, focusTab = false): Promise<void> => {
    const token = ++seq;
    current = id;
    destroyStation?.();
    destroyStation = null;
    for (const b of tabs.querySelectorAll<HTMLElement>('[role=tab]')) {
      const on = b.dataset.id === id;
      b.setAttribute('aria-selected', String(on));
      b.tabIndex = on ? 0 : -1;
      if (on && focusTab) b.focus();
    }
    stage.setAttribute('aria-labelledby', `story-tab-${id}`);
    stage.scrollTop = 0;
    const render = STATIC_TABS[id];
    if (render) {
      stage.replaceChildren(render(store.state.depth));
      return;
    }
    stage.replaceChildren(h('div', { class: 'station-loading' }, 'Loading interactive station…'));
    const mod = await loadExplainer(id);
    // closed, another tab picked, or the dialog reused while the chunk loaded
    if (!alive || token !== seq || !stage.isConnected) return;
    if (!mod) {
      // Retry removes the focused button: put keyboard focus back on the tab instead of <body>
      stage.replaceChildren(loadErrorNotice(() => void select(id, true)));
      return;
    }
    const host = h('div', { class: 'station-host station-host-full' });
    stage.replaceChildren(h('h3', { class: 'station-title' }, mod.title), h('p', { class: 'station-sub' }, mod.subtitle), host);
    destroyStation = mountStation(mod, host, '#5cd3ff');
  };

  for (const t of STORY_TABS) {
    tabs.appendChild(
      h('button', { class: 'tab', role: 'tab', id: `story-tab-${t.id}`, 'aria-controls': 'story-panel', 'data-id': t.id, onclick: () => void select(t.id) }, t.label),
    );
  }
  tabs.addEventListener('keydown', (e) => {
    const i = STORY_TABS.findIndex((t) => t.id === current);
    const n = STORY_TABS.length;
    const j = e.key === 'ArrowRight' ? (i + 1) % n : e.key === 'ArrowLeft' ? (i - 1 + n) % n : e.key === 'Home' ? 0 : e.key === 'End' ? n - 1 : -1;
    if (j < 0) return;
    e.preventDefault();
    void select(STORY_TABS[j].id, true);
  });
  const unsub = store.subscribe((s, prev) => {
    const render = STATIC_TABS[current];
    if (s.depth === prev.depth || !render) return;
    const top = stage.scrollTop;
    stage.replaceChildren(render(s.depth));
    stage.scrollTop = top;
  });

  modal.open(
    [
      h(
        'header',
        { class: 'modal-head' },
        h('div', { class: 'modal-head-text' }, h('div', { class: 'kicker' }, 'Why upgrade?'), h('h2', { class: 'modal-title' }, 'What changed in the APS Upgrade')),
        depth.el,
      ),
      tabs,
      stage,
    ],
    () => {
      alive = false;
      seq++;
      unsub();
      depth.dispose();
      destroyStation?.();
      destroyStation = null;
    },
    'The APS Upgrade',
    'story',
  );
  void select(startTab);
}

// ------------------------------------------------------------------ help

export function openHelp(modal: Modal): void {
  const row = (k: string, v: string) => h('tr', null, h('th', null, ...k.split(' | ').flatMap((x, i) => (i ? [' ', h('kbd', null, x)] : [h('kbd', null, x)]))), h('td', null, v));
  const touch = coarsePointer();
  modal.open(
    [
      h('h2', { class: 'modal-title' }, 'How to explore'),
      h(
        'table',
        { class: 'keys' },
        h(
          'tbody',
          null,
          ...(touch
            ? [row('Drag', 'Orbit the camera'), row('Two-finger drag', 'Pan'), row('Pinch', 'Zoom'), row('Tap', 'Enter a feature beamline or select a component')]
            : [row('Drag', 'Orbit the camera'), row('Right-drag', 'Pan'), row('Scroll', 'Zoom toward the cursor'), row('Click', 'Enter a feature beamline or select a component')]),
          row('← | → | ↑ | ↓', 'Orbit (when the 3D view has focus)'),
          row('Shift + arrows', 'Pan'),
          row('+ | − | PgUp | PgDn', 'Zoom in / out'),
          row('Home', 'Frame the current view'),
          row('Esc', 'Step back (component → beamline → whole APS)'),
          row('[ | ]', 'Previous / next component along the beam'),
          row('F', 'Frame the whole beamline'),
          row('R', 'Ride the beam from source to sample'),
          row('T', 'Start / stop the guided tour'),
          row('V', 'Toggle Visitor / Specialist depth'),
          row('/ | Ctrl+K', 'Search beamlines, components, techniques, sectors'),
          row('1 – 9', 'Jump to a feature beamline'),
        ),
      ),
      p(
        '**Visitor** mode explains everything in plain language. **Specialist** mode switches to dense technical text, shows full parameter tables, design-record figures and open questions.',
      ),
      p('Distances along each beamline are true to the published designs; component sizes are realistic but simplified. Elsewhere on the floor, hutches are schematic.', 'muted small'),
      h('h3', { class: 'about-h' }, 'About this exhibit'),
      p(
        'An independent educational visualization — **not an official APS or Argonne product**. Every beamline is described by a dossier researched from public sources and checked by a second, adversarial fact-checking pass; each beamline component and parameter links to its source in the beamline’s *Specs & sources* tab. Status reflects the APS commissioning chart and news as of October 2026.',
      ),
      h(
        'ul',
        { class: 'small about-src' },
        h('li', null, 'APS Upgrade ', h('a', { href: 'https://www.aps.anl.gov/APS-Upgrade/Documents', target: '_blank', rel: 'noopener' }, 'Final Design Report (2019) and Preliminary Design Report (2017)'), ' — layouts, optics and instrument designs.'),
        h('li', null, h('a', { href: 'https://www.aps.anl.gov/APS-Upgrade/Feature-Beamlines', target: '_blank', rel: 'noopener' }, 'APS feature-beamline pages'), ', the APS Beamline Directory, sector locations and news (2023–2026).'),
        h('li', null, 'Peer-reviewed and conference papers (J. Synchrotron Rad., Rev. Sci. Instrum., MEDSI, SRI, IPAC, SPIE) cited per beamline.'),
        h('li', null, 'Site footprints © ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap contributors'), ' (ODbL); ring geometry fitted to documented parameters.'),
        h('li', null, 'Design-record figures are reproduced with attribution from the cited reports for educational purposes.'),
      ),
    ],
    undefined,
    'Help',
  );
}

// ------------------------------------------------------------------ tour card

/** Legend for the storage-ring close-up: the magnet colours of the 3D lattice (src/scene/site/lattice.ts). */
function magnetLegend(): HTMLElement {
  const hex = (m: { color: { getHexString(): string } }) => `#${m.color.getHexString()}`;
  const items: [string, string][] = [
    ['Bending magnet', hex(mats.magnetDipole())],
    ['Reverse bend', hex(mats.magnetReverse())],
    ['Quadrupole (focusing)', hex(mats.magnetQuad())],
    ['Sextupole', hex(mats.magnetSext())],
    ['Fast corrector', hex(mats.magnetCorrector())],
  ];
  return h(
    'div',
    { class: 'tour-legend small', role: 'list', 'aria-label': 'Magnet colours' },
    ...items.map(([label, c]) => h('span', { class: 'tour-legend-item', role: 'listitem' }, h('i', { style: `background:${c}`, 'aria-hidden': 'true' }), label)),
  );
}

const isRingShot = (s: TourStep) => s.shot.kind === 'site' && s.shot.target === 'ring';

export class TourCard {
  readonly el: HTMLElement;
  private body: HTMLElement;
  private counter: HTMLElement;
  private playBtn: HTMLButtonElement;
  private nextBtn: HTMLButtonElement;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private playing = false;
  onStep: (i: number) => void = () => {};
  onExit: () => void = () => {};
  onOpenBeamline: (id: string) => void = () => {};
  private step = 0;

  constructor() {
    this.body = h('div', { class: 'tour-body', 'aria-live': 'polite' });
    this.counter = h('span', { class: 'tour-count mono small muted' });
    this.playBtn = h('button', { class: 'btn btn-ghost btn-icon', 'aria-label': 'Play tour automatically', title: 'Play tour automatically', 'aria-pressed': 'false', onclick: () => this.togglePlay() }, icon('play', 16)) as HTMLButtonElement;
    this.nextBtn = h('button', { class: 'btn btn-primary tour-next', onclick: () => this.go(this.step + 1) }) as HTMLButtonElement;
    this.el = h(
      'section',
      { class: 'tour glass', 'aria-label': 'Guided tour', inert: true },
      this.body,
      h(
        'div',
        { class: 'tour-ctrl' },
        h('button', { class: 'btn btn-ghost tour-exit', 'aria-label': 'Exit tour', title: 'Exit tour (T)', onclick: () => this.onExit() }, icon('close', 15), h('span', { class: 'tour-exit-label' }, 'Exit tour')),
        h('span', { class: 'flex1' }),
        h('button', { class: 'btn btn-icon', 'aria-label': 'Previous stop', title: 'Previous stop', onclick: () => this.go(this.step - 1) }, icon('back', 16)),
        this.counter,
        this.playBtn,
        this.nextBtn,
      ),
    );
  }

  show(i: number): void {
    this.step = i;
    const s = TOUR[i];
    if (!s) return;
    this.el.classList.add('is-open');
    this.el.inert = false;
    this.el.style.setProperty('--c', s.color ?? '#5cd3ff');
    const specialist = store.state.depth === 'specialist';
    this.body.replaceChildren(
      ...nodes(
        h('div', { class: 'kicker' }, s.kicker),
        h('h3', { class: 'tour-title' }, s.title),
        p(specialist && s.expert ? s.expert : s.plain),
        isRingShot(s) ? magnetLegend() : null,
        s.beamline ? h('button', { class: 'btn tour-open', onclick: () => this.onOpenBeamline(s.beamline!) }, icon('layers', 15), `Step inside ${s.title.split(' ')[0]}`) : null,
      ),
    );
    this.counter.textContent = `${i + 1} / ${TOUR.length}`;
    this.counter.setAttribute('aria-label', `Stop ${i + 1} of ${TOUR.length}`);
    const last = i >= TOUR.length - 1;
    this.nextBtn.replaceChildren(...(last ? ['Start exploring'] : ['Next', icon('next', 15)]));
    this.nextBtn.title = last ? 'End the tour and explore on your own' : 'Next stop';
    if (this.playing) this.schedule();
  }

  hide(): void {
    this.el.classList.remove('is-open');
    this.el.inert = true;
    this.stopPlay();
  }

  private go(i: number): void {
    if (i < 0) return;
    if (i >= TOUR.length) {
      this.onExit();
      return;
    }
    this.onStep(i);
  }

  private setPlayUi(): void {
    const label = this.playing ? 'Pause tour' : 'Play tour automatically';
    this.playBtn.replaceChildren(icon(this.playing ? 'pause' : 'play', 16));
    this.playBtn.setAttribute('aria-pressed', String(this.playing));
    this.playBtn.setAttribute('aria-label', label);
    this.playBtn.title = label;
  }

  private togglePlay(): void {
    if (this.playing) this.stopPlay();
    else {
      this.playing = true;
      this.setPlayUi();
      this.schedule();
    }
  }

  private stopPlay(): void {
    this.playing = false;
    this.setPlayUi();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const words = (TOUR[this.step]?.plain ?? '').split(/\s+/).length;
    this.timer = setTimeout(() => this.go(this.step + 1), Math.max(9000, words * 330));
  }
}
