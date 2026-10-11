import { h, icon, nodes, p } from '../lib/dom';
import { store } from '../app/store';
import { FEATURE_META } from '../data/meta';
import { BEAMLINES } from '../data/beamlines';
import { OVERVIEW_COPY } from '../data/copy';
import { enhancedSectors, SECTOR_INFO } from '../data/sectors';
import type { BeamlineMeta } from '../data/types';

/**
 * Text of a feature-beamline card, shared by the guide and the sector card: where it is and its acronym, an everyday
 * descriptor of what it is for, and the expanded name in fine print (what the letters stand for).
 */
export function featureCardText(m: BeamlineMeta, where: string): HTMLElement {
  return h(
    'span',
    { class: 'fc-text' },
    h('span', { class: 'fc-top' }, h('span', { class: 'fc-sector mono' }, where), h('span', { class: 'fc-acr' }, BEAMLINES[m.id]?.acronym ?? m.id.toUpperCase())),
    h('span', { class: 'fc-short' }, m.short),
    h('span', { class: 'fc-full' }, m.displayName),
  );
}

/** '4-ID', or the station where two feature beamlines share a sector ('34-ID-E', '34-ID-F'). */
export function featureWhere(m: BeamlineMeta): string {
  const shared = FEATURE_META.some((o) => o.id !== m.id && o.sectorNumber === m.sectorNumber);
  return shared && !m.stations.includes(',') ? m.stations : `${m.sectorNumber}-ID`;
}

/**
 * Left-hand "gallery guide" in the overview: what the APS is, what changed, and the nine feature beamlines.
 */
export class OverviewPanel {
  readonly el: HTMLElement;
  private list: HTMLElement;
  private intro: HTMLElement;
  private enhanced: HTMLElement;
  private scroll: HTMLElement;
  private collapseBtn: HTMLElement;
  onHover: (id: string | null) => void = () => {};
  onOpen: (id: string) => void = () => {};
  onStory: () => void = () => {};
  onTour: () => void = () => {};

  constructor() {
    this.list = h('ol', { class: 'feature-list' });
    this.intro = h('div', { class: 'ov-intro' });
    this.enhanced = h('ul', { class: 'enh-list' });
    this.scroll = h('div', { class: 'ov-scroll', id: 'ov-guide-body' }, this.intro, h('h2', { class: 'kicker ov-kicker' }, 'The nine APS-U feature beamlines'), this.list, this.enhancedBlock(), this.legend());
    this.collapseBtn = h(
      'button',
      {
        class: 'btn btn-ghost btn-icon ov-collapse',
        'aria-controls': 'ov-guide-body',
        onclick: () => this.setCollapsed(!this.el.classList.contains('is-collapsed')),
      },
      icon('back', 16),
    );
    this.el = h('aside', { class: 'ov-panel glass', 'aria-label': 'Exhibit guide' }, this.collapseBtn, this.scroll);
    this.render();
    this.setCollapsed(window.innerWidth < 760);
  }

  private setCollapsed(c: boolean): void {
    this.el.classList.toggle('is-collapsed', c);
    this.scroll.inert = c; // slid off-screen: keep Tab out of it
    this.collapseBtn.setAttribute('aria-expanded', String(!c));
    this.collapseBtn.setAttribute('aria-label', c ? 'Expand guide' : 'Collapse guide');
    this.collapseBtn.title = c ? 'Expand the guide' : 'Collapse the guide';
  }

  /** The 15 enhancement programs: existing beamlines given new optics/instruments to exploit the new source. */
  private enhancedBlock(): HTMLElement | null {
    const n = enhancedSectors().length;
    if (!n) return null;
    return h(
      'details',
      { class: 'enh-block' },
      h('summary', null, h('span', { class: 'kicker' }, `Also upgraded · ${n} enhanced sectors`), h('span', { class: 'small muted' }, ' — existing beamlines given new optics and instruments')),
      this.enhanced,
    );
  }

  /** Each enhanced sector: its everyday label, with the directory titles of the enhanced beamlines in fine print. */
  private renderEnhanced(): void {
    this.enhanced.replaceChildren(
      ...enhancedSectors().map((n) => {
        const info = SECTOR_INFO[n];
        const bls = info.beamlines.filter((b) => b.enhanced);
        const directory = bls.map((b) => b.title?.replace(/^[^:]*:\s*/, '') || b.name).join(' · ');
        const label = info.plainLabel || directory;
        return h(
          'li',
          null,
          h(
            'button',
            { class: 'enh-item', onclick: () => store.go({ mode: 'overview', focus: String(n) }) },
            h('span', { class: 'enh-sec mono' }, `${n}-ID`),
            h(
              'span',
              { class: 'enh-text' },
              h('span', { class: 'enh-title' }, label),
              info.plainLabel && directory ? h('span', { class: 'enh-dir' }, directory) : null,
            ),
          ),
        );
      }),
    );
  }

  private legend(): HTMLElement {
    return h(
      'div',
      { class: 'legend small' },
      h('div', null, h('i', { class: 'lg lg-e' }), 'Electron beam (6 GeV storage ring, booster, linac)'),
      h('div', null, h('i', { class: 'lg lg-x' }), 'X-ray beamlines (one per insertion device / bending magnet)'),
      h('div', null, h('i', { class: 'lg lg-f' }), 'Feature beamline — click to step inside'),
      enhancedSectors().length ? h('div', null, h('i', { class: 'lg lg-enh' }), 'Beamline enhanced by the upgrade — hover for details') : null,
      h('div', { class: 'muted' }, 'Hover any sector of the hall to see what runs there. Hutches outside the feature beamlines are schematic.'),
    );
  }

  render(): void {
    const c = OVERVIEW_COPY;
    const notes = c.stats.filter((s) => s.note);
    this.intro.replaceChildren(
      ...nodes(
        h('div', { class: 'kicker' }, 'Advanced Photon Source · Argonne National Laboratory'),
        h('h1', { class: 'ov-title', tabindex: '-1' }, c.title),
        p(c.text),
        h('div', { class: 'stat-row' }, ...c.stats.map((s) => h('div', { class: 'stat', title: s.note ?? '' }, h('div', { class: 'stat-v mono' }, s.value), h('div', { class: 'stat-l' }, s.label)))),
        // the caveats behind the four numbers, as fine print (the tooltips above are not reachable by touch)
        notes.length
          ? h(
              'details',
              { class: 'ov-notes' },
              h('summary', null, 'About these numbers'),
              h('dl', { class: 'fineprint' }, ...notes.flatMap((s) => [h('dt', null, `${s.value} ${s.label}`), h('dd', null, s.note!)])),
            )
          : null,
        h(
          'div',
          { class: 'cta-row' },
          h('button', { class: 'btn btn-primary', onclick: () => this.onTour() }, icon('tour', 15), 'Take the guided tour'),
          h('button', { class: 'btn', onclick: () => this.onStory() }, icon('bolt', 15), 'Why upgrade?'),
        ),
      ),
    );
    this.list.replaceChildren(
      ...FEATURE_META.map((m) => {
        return h(
          'li',
          null,
          h(
            'button',
            {
              class: 'feature-card',
              style: `--c:${m.color}`,
              onmouseenter: () => this.onHover(m.id),
              onmouseleave: () => this.onHover(null),
              onfocus: () => this.onHover(m.id),
              onblur: () => this.onHover(null),
              onclick: () => this.onOpen(m.id),
            },
            h('span', { class: 'fc-dot', 'aria-hidden': 'true' }),
            featureCardText(m, featureWhere(m)),
            icon('next', 15),
          ),
        );
      }),
    );
    this.renderEnhanced();
  }

  setHot(id: string | null): void {
    for (const btn of this.list.querySelectorAll<HTMLElement>('.feature-card')) btn.classList.remove('is-hot');
    if (!id) return;
    const idx = FEATURE_META.findIndex((m) => m.id === id);
    this.list.querySelectorAll<HTMLElement>('.feature-card')[idx]?.classList.add('is-hot');
  }

  setVisible(v: boolean): void {
    this.el.classList.toggle('is-away', !v);
    this.el.inert = !v;
  }
}
