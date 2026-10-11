import { h, icon, svg } from '../lib/dom';
import { store, type Quality } from '../app/store';

export interface Crumb {
  label: string;
  onClick?: () => void;
}

function moreIcon(): SVGSVGElement {
  const s = svg('svg', { viewBox: '0 0 24 24', width: 18, height: 18, fill: 'currentColor', 'aria-hidden': 'true' });
  s.innerHTML = '<circle cx="5" cy="12" r="1.9"/><circle cx="12" cy="12" r="1.9"/><circle cx="19" cy="12" r="1.9"/>';
  return s;
}

/** Rendering-quality controls (used by the desktop gear popover and the phone menu). */
function settingsControls(): HTMLElement[] {
  const q = h('div', { class: 'seg', role: 'group', 'aria-label': 'Rendering quality' });
  for (const [v, label] of [
    ['high', 'High'],
    ['balanced', 'Balanced'],
    ['low', 'Light'],
  ] as [Quality, string][]) {
    q.appendChild(h('button', { 'data-q': v, 'aria-pressed': String(store.state.quality === v), onclick: () => store.set({ quality: v, qualityChosen: true }) }, label));
  }
  store.subscribe((s, prev) => {
    if (s.quality !== prev.quality) for (const b of q.querySelectorAll<HTMLElement>('button')) b.setAttribute('aria-pressed', String(b.dataset.q === s.quality));
  });
  return [
    h('div', { class: 'kicker' }, 'Rendering'),
    q,
    h('p', { class: 'small muted' }, 'Use “Light” on laptops with integrated graphics.'),
  ];
}

export class TopBar {
  readonly el: HTMLElement;
  private crumbs: HTMLElement;
  private settings: HTMLElement;
  private menu: HTMLElement;
  private settingsBtn: HTMLElement;
  private menuBtn: HTMLElement;
  /** the open popover and the button that opened it */
  private openPop: { pop: HTMLElement; btn: HTMLElement } | null = null;
  onHome: () => void = () => {};
  onTour: () => void = () => {};
  onStory: () => void = () => {};
  onHelp: () => void = () => {};
  onAuthor: () => void = () => {};
  onSearch: () => void = () => {};

  constructor() {
    const mark = svg('svg', { viewBox: '0 0 40 40', class: 'brand-mark', 'aria-hidden': 'true' });
    mark.innerHTML =
      '<circle cx="20" cy="22" r="13" fill="none" stroke="#ffb547" stroke-width="2.6"/>' +
      '<path d="M20 9 L38 4" stroke="#5cd3ff" stroke-width="2.6" stroke-linecap="round"/>' +
      '<path d="M31 13 L39 15" stroke="#5cd3ff" stroke-width="2" stroke-linecap="round" opacity=".7"/>' +
      '<circle cx="20" cy="9" r="2.6" fill="#fff"/>';
    const brand = h(
      'button',
      { class: 'brand', onclick: () => this.onHome(), 'aria-label': 'APS-U Beamline Explorer: back to the whole APS', title: 'Back to the whole APS' },
      mark,
      h(
        'span',
        { class: 'brand-text' },
        h('span', { class: 'brand-title' }, h('span', { class: 'bt-full' }, 'APS-U Beamline Explorer'), h('span', { class: 'bt-short' }, 'APS-U Explorer')),
        h('span', { class: 'brand-sub' }, 'Advanced Photon Source · Argonne'),
      ),
    );
    this.crumbs = h('nav', { class: 'crumbs', 'aria-label': 'Breadcrumb' });

    // Popovers live directly in the header (position: fixed), never inside the tool row, whose overflow or
    // backdrop-filter would clip them.
    this.settings = h('div', { class: 'popover settings glass', id: 'tb-settings', role: 'group', 'aria-label': 'Display settings' }, ...settingsControls());
    this.settingsBtn = h(
      'button',
      { class: 'btn btn-icon tb-wide', 'aria-label': 'Display settings', title: 'Display settings', 'aria-expanded': 'false', 'aria-controls': 'tb-settings', onclick: (e: Event) => this.toggle(this.settings, e.currentTarget as HTMLElement) },
      icon('gear', 17),
    );

    // Phone: Story, Tour, Author's note, Help and the rendering settings fold into one menu.
    // focus goes back to the menu button first, so a dialog opened from the menu returns focus there on close
    // (the item itself is hidden by then)
    const item = (ic: Parameters<typeof icon>[0], label: string, fn: () => void) =>
      h('button', { class: 'btn btn-ghost menu-item', onclick: () => (this.closePop(true), fn()) }, icon(ic, 16), label);
    this.menu = h(
      'div',
      { class: 'popover tb-menu glass', id: 'tb-menu', role: 'group', 'aria-label': 'More' },
      item('bolt', 'The upgrade', () => this.onStory()),
      item('tour', 'Guided tour', () => this.onTour()),
      item('pen', 'Author’s note', () => this.onAuthor()),
      item('keyboard', 'Help', () => this.onHelp()),
      ...settingsControls(),
    );
    this.menuBtn = h(
      'button',
      { class: 'btn btn-icon btn-ghost tb-more', 'aria-label': 'More: the upgrade, tour, author’s note, help, settings', title: 'More', 'aria-expanded': 'false', 'aria-controls': 'tb-menu', onclick: (e: Event) => this.toggle(this.menu, e.currentTarget as HTMLElement) },
      moreIcon(),
    );

    document.addEventListener('click', (e) => {
      const t = e.target as Node;
      if (this.openPop && !this.openPop.pop.contains(t) && !this.openPop.btn.contains(t)) this.closePop(false);
    });
    // capture phase: runs before the app's global shortcuts, so Escape only closes the popover
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key === 'Escape' && this.openPop) {
          e.preventDefault();
          e.stopPropagation();
          this.closePop(true);
        }
      },
      true,
    );
    window.addEventListener('resize', () => this.place());
    store.subscribe((s, prev) => {
      if (s.view !== prev.view) this.closePop(false);
      if (s.quality !== prev.quality) document.documentElement.dataset.quality = s.quality;
    });
    // expose the rendering tier to CSS (panel blur is only switched on in 'high'); the governor also goes through the store
    document.documentElement.dataset.quality = store.state.quality;

    this.el = h(
      'header',
      { class: 'topbar' },
      brand,
      this.crumbs,
      h('span', { class: 'topbar-spacer pass' }),
      h(
        'div',
        { class: 'topbar-tools glass' },
        h('button', { class: 'btn btn-ghost btn-icon', onclick: () => this.onSearch(), title: 'Search (/ or Ctrl+K)', 'aria-label': 'Search' }, icon('search', 17)),
        h('button', { class: 'btn btn-ghost tb-wide', onclick: () => this.onStory(), 'aria-label': 'The upgrade', title: 'Why the upgrade? Interactive stations about the new storage ring' }, icon('bolt', 16), h('span', { class: 'tb-label' }, 'The upgrade')),
        h('button', { class: 'btn btn-ghost tb-wide', onclick: () => this.onTour(), 'aria-label': 'Guided tour', title: 'Guided tour (T)' }, icon('tour', 16), h('span', { class: 'tb-label' }, 'Guided tour')),
        h('button', { class: 'btn btn-ghost btn-icon tb-wide', onclick: () => this.onAuthor(), 'aria-label': 'Author’s note', title: 'Author’s note' }, icon('pen', 17)),
        this.settingsBtn,
        h('button', { class: 'btn btn-icon btn-ghost tb-wide', 'aria-label': 'Help and keyboard shortcuts', title: 'Help (?)', onclick: () => this.onHelp() }, icon('keyboard', 17)),
        this.menuBtn,
      ),
      this.settings,
      this.menu,
    );
    // a dialog, search or the intro opened on top (e.g. with a key while a popover was open) makes the header
    // inert: close the popover so it neither lingers behind the dialog nor swallows the dialog's Escape
    new MutationObserver(() => {
      if (this.el.inert) this.closePop(false);
    }).observe(this.el, { attributes: true, attributeFilter: ['inert'] });
  }

  private toggle(pop: HTMLElement, btn: HTMLElement): void {
    const same = this.openPop?.pop === pop;
    this.closePop(false);
    if (same) return;
    this.openPop = { pop, btn };
    pop.classList.add('is-open');
    btn.setAttribute('aria-expanded', 'true');
    this.place();
  }

  /** Anchor the open popover under its button (fixed positioning, clamped to the viewport). */
  private place(): void {
    if (!this.openPop) return;
    const { pop, btn } = this.openPop;
    const r = btn.getBoundingClientRect();
    if (!r.width) return this.closePop(false);
    pop.style.top = `${Math.round(r.bottom + 10)}px`;
    pop.style.right = `${Math.max(8, Math.round(window.innerWidth - r.right))}px`;
  }

  private closePop(returnFocus: boolean): void {
    if (!this.openPop) return;
    const { pop, btn } = this.openPop;
    this.openPop = null;
    pop.classList.remove('is-open');
    btn.setAttribute('aria-expanded', 'false');
    if (returnFocus) btn.focus();
  }

  setCrumbs(list: Crumb[]): void {
    this.crumbs.replaceChildren(
      ...list.flatMap((c, i) => {
        const node = c.onClick ? h('button', { class: 'crumb', onclick: c.onClick }, c.label) : h('span', { class: 'crumb is-current', 'aria-current': 'page', title: c.label }, c.label);
        return i ? [h('span', { class: 'crumb-sep', 'aria-hidden': 'true' }, '›'), node] : [node];
      }),
    );
  }
}
