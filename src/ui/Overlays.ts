import { h, icon, nodes, p, rich } from '../lib/dom';
import { Modal, holdExclusive, loadErrorNotice, mountStation } from './Modal';
import { loadExplainer } from './explainers/registry';
import { FACILITY, type Param } from '../data/facility';
import { TOUR, type TourStep } from '../data/tour';
import { metaById } from '../data/meta';
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
        'Electrons circulate in a kilometre-long storage ring and emit X-rays about 500 times brighter than before the upgrade. Explore the facility and its nine new feature beamlines. Try the interactive stations to see how scientists study materials with these X-rays.',
      ),
      h('div', { class: 'cta-row' }, primary, h('button', { class: 'btn btn-lg', onclick: () => onExplore() }, icon('ring', 17), 'Explore freely')),
      h('div', { class: 'intro-hints small' }, ...hints.map(([k, v]) => h('span', null, h('b', null, k), v))),
      h(
        'p',
        { class: 'intro-fine small muted' },
        'This independent educational visualization uses public APS and Argonne documents and peer-reviewed publications. Sources are listed for each beamline. It is not an official APS product. Hutches outside the feature beamlines are schematic.',
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
  { id: 'mba', label: 'Storage-ring magnets' },
  { id: 'brightness', label: 'Brightness' },
  { id: 'undulator', label: 'Undulators' },
  { id: 'coherence', label: 'Coherence' },
  { id: 'numbers', label: 'By the numbers' },
  { id: 'timeline', label: 'Timeline' },
];

const PRIMER: [string, string][] = [
  ['whatIsSynchrotron', 'Synchrotron light sources'],
  ['whatIsUndulator', 'Undulators'],
  ['whatIsMBA', 'Multi-bend achromats'],
  ['whyEmittanceMatters', 'Emittance and brightness'],
  ['whatIsCoherence', 'Coherence'],
  ['whatIsSwapOut', 'Swap-out injection'],
  ['whatIsBunchLengthening', 'Bunch lengthening'],
  ['whyLowerEnergy', 'The change from 7 to 6 GeV'],
  ['whyRoundBeams', 'Round electron beams'],
];

/** A primer answer: one or two paragraphs separated by a blank line, each its own <p>. */
const paragraphs = (text: string): HTMLParagraphElement[] =>
  text
    .split(/\n\s*\n/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => p(typo(t)));

function primer(): HTMLElement {
  const ex = FACILITY.explainers ?? {};
  return h(
    'div',
    { class: 'primer' },
    ...PRIMER.filter(([k]) => ex[k]).map(([k, title], i) => h('details', { class: 'primer-item', open: i === 0 }, h('summary', null, title), ...paragraphs(ex[k]))),
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

/**
 * The ring before and after. The APS-U column is what users get: the round-beam (full-coupling) user mode;
 * the flat, low-coupling mode is given underneath. Row notes are fine print: what the number is and its caveat.
 */
function compareTable(): HTMLElement {
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
      'Horizontal design emittance',
      'The beam\'s size multiplied by its angular spread. The APS value describes the beam as operated. The APS-U value is the natural emittance calculated for the new lattice, about 75 times smaller.',
      one(B.horizontalEmittance),
      one(A.naturalEmittance),
    ],
    [
      'User-mode emittance, horizontal × vertical',
      roundErr.h && roundErr.v
        ? `Measured in 2024 with full coupling between the horizontal and vertical planes. The emittance was ${roundErr.h} horizontally and ${roundErr.v} vertically.`
        : 'Measured in 2024 in round-beam user mode, with full coupling between the horizontal and vertical planes.',
      pair(valOf(B.horizontalEmittance), valOf(B.verticalEmittance), unitOf(B.horizontalEmittance)),
      pair(roundEmit.h, roundEmit.v, unitOf(A.emittanceMeasuredRound)),
    ],
    [
      'Beam size at an undulator, horizontal × vertical',
      'Root-mean-square values calculated for round-beam user mode at zero current.',
      pair(valOf(B.horizontalBeamSizeAtID), valOf(B.verticalBeamSizeAtID), unitOf(B.horizontalBeamSizeAtID)),
      pair(valOf(A.horizontalBeamSizeAtID_round), valOf(A.verticalBeamSizeAtID_round), unitOf(A.horizontalBeamSizeAtID_round)),
    ],
    [
      'Beam divergence, horizontal × vertical',
      'The beam\'s angular spread. The APS-U root-mean-square values are calculated for round-beam user mode at zero current.',
      pair(valOf(B.horizontalDivergenceAtID), valOf(B.verticalDivergenceAtID), unitOf(B.horizontalDivergenceAtID)),
      pair(roundDiv.h, roundDiv.v, unitOf(A.divergenceAtID_round)),
    ],
    ['Circumference', '', one(B.circumference), one(A.circumference)],
    ['Magnets', '', one(B.magnets), magnetsAfter ? `${magnetsAfter} magnets` : ''],
    ['Radio frequency', '', one(B.rfFrequency), one(A.rfFrequency)],
  ];
  const flatEmit = planes(A.emittanceMeasuredFlat, true);
  const flatModel = pair(valOf(A.horizontalEmittanceFlatModel), valOf(A.verticalEmittanceFlatModel), unitOf(A.horizontalEmittanceFlatModel));
  const flatSize = pair(valOf(A.horizontalBeamSizeAtID_flat), valOf(A.verticalBeamSizeAtID_flat), unitOf(A.horizontalBeamSizeAtID_flat));
  const flatDiv = pair(valOf(A.horizontalDivergenceAtID_flat), valOf(A.verticalDivergenceAtID_flat), unitOf(A.horizontalDivergenceAtID_flat));
  const flat =
    'Users normally receive the round beam shown here. Its emittance is shared equally between the horizontal and vertical planes, with full coupling, κ = 1. ' +
    (flatModel && flatSize
      ? `A flat beam with lower coupling, κ = 0.1, is also possible. The model gives an emittance of ${flatModel}${flatEmit.h && flatEmit.v ? `. Measurements gave ${flatEmit.h} horizontally and ${flatEmit.v} vertically` : ''}. The calculated beam size is ${flatSize}${flatDiv ? ` and the divergence is ${flatDiv}` : ''}. Sizes and divergences are root-mean-square values. `
      : '') +
    'The APS-U beam sizes and divergences are model values at zero current.';
  return h(
    'div',
    { class: 'compare-wrap' },
    p('Scroll sideways to see both columns.', 'small muted compare-scroll-hint'),
    h(
      'div',
      { class: 'compare-scroll', role: 'region', tabindex: '0', 'aria-label': 'APS and APS-U comparison; scroll horizontally to see all columns on a small screen' },
      h(
        'table',
        { class: 'specs compare' },
        h('caption', { class: 'sr-only' }, 'The storage ring before and after the upgrade'),
        h('thead', null, h('tr', null, h('th', { scope: 'col' }, h('span', { class: 'sr-only' }, 'Parameter')), h('th', { scope: 'col' }, 'APS, last operated in 2023'), h('th', { scope: 'col' }, 'APS-U, user mode since 2024'))),
        h(
          'tbody',
          null,
          ...rows
            .filter(([, , b, a]) => b || a)
            .map(([label, note, b, a]) =>
              h('tr', null, h('th', { scope: 'row' }, label, note ? h('div', { class: 'fineprint compare-row-note' }, note) : null), h('td', { class: 'mono' }, b || 'Unavailable'), h('td', { class: 'mono hl' }, a || 'Unavailable')),
            ),
        ),
      ),
    ),
    p(flat, 'fineprint compare-note'),
  );
}

function numbers(): HTMLElement {
  const cards = (FACILITY.exhibitNumbers ?? []).map((n) => {
    const exp = n.explanation;
    return h(
      'div',
      { class: 'num-card' },
      h('div', { class: 'num-label' }, rich(typo(n.label))),
      h('div', { class: 'num-value' }, rich(typo(n.value))),
      exp ? h('div', { class: 'num-exp small muted' }, rich(typo(exp))) : null,
    );
  });
  return h('div', { class: 'numbers-tab' }, compareTable(), h('div', { class: 'num-grid' }, ...cards));
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

function timeline(): HTMLElement {
  const items = [...(FACILITY.timeline ?? [])].sort((a, b) => dateKey(a.date).localeCompare(dateKey(b.date)));
  if (!items.length) return p('Timeline data unavailable.');
  return h(
    'ol',
    { class: 'timeline' },
    ...items.map((t) => {
      // the full date, day included where it is known; machine-readable when it is a plain ISO date
      const iso = /^\d{4}(?:-\d{2}){0,2}$/.test(t.date.trim()) ? t.date.trim() : undefined;
      return h(
        'li',
        null,
        h(iso ? 'time' : 'div', { class: 'tl-date mono', datetime: iso }, friendlyDate(t.date)),
        h('div', { class: 'tl-event' }, rich(typo(t.event))),
      );
    }),
  );
}

/** Story tabs rendered from data (no station). */
const STATIC_TABS: Record<string, () => HTMLElement> = { primer, numbers, timeline };

export function openStory(modal: Modal, startTab = 'primer'): void {
  let alive = true;
  let seq = 0;
  let current = startTab;
  let destroyStation: (() => void) | null = null;
  const tabs = h('div', { class: 'tab-row story-tabs', role: 'tablist', 'aria-label': 'The upgrade, step by step' });
  const stage = h('div', { class: 'story-stage', role: 'tabpanel', id: 'story-panel' });

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
      stage.replaceChildren(render());
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
  modal.open(
    [
      h(
        'header',
        { class: 'modal-head' },
        h('div', { class: 'modal-head-text' }, h('div', { class: 'kicker' }, 'The APS Upgrade'), h('h2', { class: 'modal-title' }, 'Changes in the APS Upgrade')),
      ),
      tabs,
      stage,
    ],
    () => {
      alive = false;
      seq++;
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
          row('← | → | ↑ | ↓', 'Orbit while the 3D view has keyboard focus'),
          row('Shift + arrows', 'Pan'),
          row('+ | − | PgUp | PgDn', 'Zoom in / out'),
          row('Home', 'Frame the current view'),
          row('Esc', 'Return to the beamline, then to the whole APS'),
          row('[ | ]', 'Previous / next component along the beam'),
          row('F', 'Frame the whole beamline'),
          row('R', 'Move the camera along the X-ray path'),
          row('T', 'Start / stop the guided tour'),
          row('/ | Ctrl+K', 'Search beamlines, components, techniques, sectors'),
          row('1 to 9', 'Jump to a feature beamline'),
        ),
      ),
      h('h3', { class: 'about-h' }, 'Reading the exhibit'),
      p(
        'Each beamline has an overview, an interactive station, component descriptions and examples of its science. The *Specs & sources* tab contains technical parameters, figures from the design reports, unresolved questions and references.',
      ),
      p('Beamline distances follow the published designs. Component models have realistic sizes and simplified shapes. Hutches outside the feature beamlines are schematic.', 'muted small'),
      h('h3', { class: 'about-h' }, 'About this exhibit'),
      p(
        'This independent educational visualization is not an official APS or Argonne product. Beamline descriptions use public sources and were checked against those sources in a separate review. References for components and parameters are in each beamline\'s *Specs & sources* tab. Status descriptions follow the APS commissioning chart and news available in October 2026.',
      ),
      h(
        'ul',
        { class: 'small about-src' },
        h('li', null, 'APS Upgrade ', h('a', { href: 'https://www.aps.anl.gov/APS-Upgrade/Documents', target: '_blank', rel: 'noopener' }, 'Final Design Report, 2019, and Preliminary Design Report, 2017'), '. These describe layouts, optics and instrument designs.'),
        h('li', null, h('a', { href: 'https://www.aps.anl.gov/APS-Upgrade/Feature-Beamlines', target: '_blank', rel: 'noopener' }, 'APS feature-beamline pages'), ', the APS Beamline Directory, sector locations and news from 2023 to 2026.'),
        h('li', null, 'Journal and conference papers cited for each beamline. These include publications in Journal of Synchrotron Radiation and Review of Scientific Instruments, and proceedings from MEDSI, SRI, IPAC and SPIE.'),
        h('li', null, 'Site footprints © ', h('a', { href: 'https://www.openstreetmap.org/copyright', target: '_blank', rel: 'noopener' }, 'OpenStreetMap contributors'), ', under the Open Database License. Ring geometry uses documented parameters.'),
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
    ['Focusing quadrupole', hex(mats.magnetQuad())],
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
  private actions: HTMLElement;
  private counter: HTMLElement;
  private nextBtn: HTMLButtonElement;
  onStep: (i: number) => void = () => {};
  onExit: () => void = () => {};
  onOpenBeamline: (id: string) => void = () => {};
  onOpenStation: (beamlineId: string) => void = () => {};
  private step = 0;

  constructor() {
    this.body = h('div', { class: 'tour-body', 'aria-live': 'polite', role: 'region', 'aria-label': 'Tour description', tabindex: '0' });
    this.actions = h('div', { class: 'tour-actions', hidden: true });
    this.counter = h('span', { class: 'tour-count mono small muted' });
    this.nextBtn = h('button', { class: 'btn btn-primary tour-next', onclick: () => this.go(this.step + 1) }) as HTMLButtonElement;
    this.el = h(
      'section',
      { class: 'tour glass', 'aria-label': 'Guided tour', inert: true },
      this.body,
      this.actions,
      h(
        'div',
        { class: 'tour-ctrl' },
        h('button', { class: 'btn btn-ghost tour-exit', 'aria-label': 'Exit tour', title: 'Exit tour (T)', onclick: () => this.onExit() }, icon('close', 15), h('span', { class: 'tour-exit-label' }, 'Exit tour')),
        h('span', { class: 'flex1' }),
        h('button', { class: 'btn btn-icon', 'aria-label': 'Previous stop', title: 'Previous stop', onclick: () => this.go(this.step - 1) }, icon('back', 16)),
        this.counter,
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
    this.body.replaceChildren(
      ...nodes(
        h('div', { class: 'kicker' }, s.kicker),
        h('h3', { class: 'tour-title' }, s.title),
        p(s.text),
        isRingShot(s) ? magnetLegend() : null,
      ),
    );
    this.body.scrollTop = 0;
    this.actions.hidden = !s.beamline;
    this.actions.replaceChildren(...nodes(
      s.beamline ? h('button', { class: 'btn tour-open', type: 'button', onclick: () => this.onOpenBeamline(s.beamline!) }, icon('layers', 15), `Step inside ${s.title.split(' ')[0]}`) : null,
      s.beamline && metaById(s.beamline)?.explainers.length ? h(
        'button',
        { class: 'btn tour-station', type: 'button', 'aria-haspopup': 'dialog', onclick: () => this.onOpenStation(s.beamline!) },
        icon('play', 15),
        'Try the interactive station',
      ) : null,
    ));
    this.counter.textContent = `${i + 1} / ${TOUR.length}`;
    this.counter.setAttribute('aria-label', `Stop ${i + 1} of ${TOUR.length}`);
    const last = i >= TOUR.length - 1;
    this.nextBtn.replaceChildren(...(last ? ['Start exploring'] : ['Next', icon('next', 15)]));
    this.nextBtn.title = last ? 'End the tour and explore on your own' : 'Next stop';
  }

  hide(): void {
    this.el.classList.remove('is-open');
    this.el.inert = true;
  }

  focusNext(): void {
    if (!this.el.inert) this.nextBtn.focus({ preventScroll: true });
  }

  private go(i: number): void {
    if (i < 0) return;
    if (i >= TOUR.length) {
      this.onExit();
      return;
    }
    this.onStep(i);
  }
}
