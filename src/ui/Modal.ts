import { h, icon } from '../lib/dom';
import { loadExplainer, type ExplainerInstance, type ExplainerModule } from './explainers/registry';
import { BEAMLINES } from '../data/beamlines';
import { FEATURE_META, metaById } from '../data/meta';

// ------------------------------------------------------------------ exclusive overlays

/**
 * An open modal, search panel or intro makes the 3D stage, labels and other #ui children `inert`.
 * Keyboard focus stays inside the active overlay, and background elements cannot receive clicks or focus.
 * The most recently opened overlay is active.
 *
 * Other components also use `inert` for their own closed state. While an element is held here, a change made by its
 * owner is recorded and applied when the hold ends.
 */
const owners: HTMLElement[] = [];
const held = new Map<HTMLElement, boolean>(); // element → the inert state to restore
let watcher: MutationObserver | null = null;

function backgroundRoots(): HTMLElement[] {
  const ui = document.getElementById('ui');
  const roots = [document.getElementById('stage'), document.getElementById('labels'), ...(ui ? Array.from(ui.children) : [])];
  return roots.filter((e): e is HTMLElement => e instanceof HTMLElement);
}

/** Record changes to background elements, then restore their temporary inert state. */
function absorb(records: MutationRecord[]): void {
  for (const r of records) {
    const el = r.target as HTMLElement;
    if (held.has(el)) held.set(el, el.inert);
  }
  for (const el of held.keys()) el.inert = true;
  watcher?.takeRecords(); // drop the records of our own writes
}

function syncInert(): void {
  if (watcher) absorb(watcher.takeRecords());
  const top = owners[owners.length - 1];
  const want = new Set(top ? backgroundRoots().filter((el) => el !== top && !el.contains(top)) : []);
  for (const [el, prev] of held) {
    if (!want.has(el)) {
      held.delete(el);
      el.inert = prev;
    }
  }
  for (const el of want) {
    if (!held.has(el)) held.set(el, el.inert);
    el.inert = true;
  }
  watcher?.disconnect();
  if (held.size) {
    watcher ??= new MutationObserver(absorb);
    for (const el of held.keys()) watcher.observe(el, { attributes: true, attributeFilter: ['inert'] });
  }
}

const TABBABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]';

function tabbables(root: HTMLElement): HTMLElement[] {
  return Array.from(root.querySelectorAll<HTMLElement>(TABBABLE)).filter((el) => el.tabIndex >= 0 && !el.closest('[inert]') && el.getClientRects().length > 0);
}

/** Make `owner` the only interactive part of the page until the returned release function is called. */
export function holdExclusive(owner: HTMLElement): () => void {
  owners.push(owner);
  syncInert();
  // Tab wraps around inside the owner instead of leaving it for the (inert) page or the browser chrome
  const onKey = (e: KeyboardEvent) => {
    if (e.key !== 'Tab' || owners[owners.length - 1] !== owner) return;
    const items = tabbables(owner);
    const a = document.activeElement;
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey ? a === first || !owner.contains(a) : a === last || !owner.contains(a)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    }
  };
  document.addEventListener('keydown', onKey, true);
  let released = false;
  return () => {
    if (released) return;
    released = true;
    document.removeEventListener('keydown', onKey, true);
    const i = owners.lastIndexOf(owner);
    if (i >= 0) owners.splice(i, 1);
    syncInert();
  };
}

/** Is `el` (or its subtree) focusable right now? */
function focusable(el: Element | null): el is HTMLElement {
  return el instanceof HTMLElement && el.isConnected && !el.closest('[inert]') && el.getClientRects().length > 0;
}

/** Move focus to `el` if it can take it, else to nothing (body). */
export function restoreFocus(el: Element | null): void {
  if (focusable(el)) el.focus({ preventScroll: true });
  else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
}

// ------------------------------------------------------------------ modal

export type ModalSize = 'default' | 'narrow' | 'station' | 'story';

const openModals = new Set<Modal>();

/**
 * Close every open modal (and run its onClose). Used before navigating from an overlay that can sit on top of a
 * dialog (search): the dialog belongs to the view being left.
 */
export function closeModals(): void {
  for (const m of [...openModals]) m.close();
}

/** Accessible modal dialog: background inert while open, focus returned on close, Esc to close. */
export class Modal {
  readonly el: HTMLElement;
  private box: HTMLElement;
  private content: HTMLElement;
  private lastFocus: Element | null = null;
  private onCloseCb: (() => void) | null = null;
  private release: (() => void) | null = null;
  private openedAt = 0;
  /**
   * Escape closes the dialog wherever focus is (it can fall to <body> when a station re-renders the focused
   * control), unless another overlay is on top or a station already handled the key (preventDefault).
   */
  private onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape' || e.defaultPrevented || !this.isOpen || owners[owners.length - 1] !== this.el) return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  constructor(private cls = '') {
    this.content = h('div', { class: 'modal-content' });
    this.box = h(
      'div',
      { class: 'modal-box glass', role: 'dialog', 'aria-modal': 'true' },
      h('button', { class: 'btn btn-ghost btn-icon modal-close', 'aria-label': 'Close', title: 'Close (Esc)', onclick: () => this.close() }, icon('close')),
      this.content,
    );
    this.el = h(
      'div',
      {
        class: 'modal',
        inert: true,
        // backdrop click closes; ignore the tail of the click (or double-click) that opened the dialog
        onclick: (e: Event) => e.target === this.el && performance.now() - this.openedAt > 400 && this.close(),
      },
      this.box,
    );
  }

  /**
   * Show `nodes`. Opening while already open replaces the content and first runs the previous content's onClose,
   * so whatever it mounted (a station's animation loop) is torn down.
   */
  open(nodes: Node[], onClose?: () => void, label = 'Dialog', size: ModalSize = 'default'): void {
    const prev = this.onCloseCb;
    this.onCloseCb = null;
    prev?.();
    if (!this.isOpen) {
      this.lastFocus = document.activeElement;
      this.openedAt = performance.now();
    }
    this.box.className = `modal-box glass modal-${size}${this.cls ? ` ${this.cls}` : ''}`;
    this.content.replaceChildren(...nodes);
    this.box.scrollTop = 0;
    this.box.setAttribute('aria-label', label);
    this.onCloseCb = onClose ?? null;
    this.el.inert = false;
    this.el.classList.add('is-open');
    if (!this.release) {
      this.release = holdExclusive(this.el);
      openModals.add(this);
      // bubble phase on window: a station's own Escape handling (inside the dialog) runs first
      window.addEventListener('keydown', this.onKey);
    }
    requestAnimationFrame(() => {
      if (this.isOpen && !this.box.contains(document.activeElement)) (this.box.querySelector('button, [href], input, [tabindex]') as HTMLElement | null)?.focus();
    });
  }

  get isOpen(): boolean {
    return this.el.classList.contains('is-open');
  }

  close(): void {
    if (!this.isOpen) return;
    this.el.classList.remove('is-open');
    const cb = this.onCloseCb;
    this.onCloseCb = null;
    this.release?.();
    this.release = null;
    openModals.delete(this);
    window.removeEventListener('keydown', this.onKey);
    this.el.inert = true;
    const f = this.lastFocus;
    this.lastFocus = null;
    restoreFocus(f);
    // A close callback may reopen this modal. Finish closing before it opens the next content.
    cb?.();
  }
}

// ------------------------------------------------------------------ shared pieces for station / story dialogs

/** "This station could not load" notice with a Retry button (chunk 404 after a redeploy, offline kiosk…). */
export function loadErrorNotice(onRetry: () => void): HTMLElement {
  return h(
    'div',
    { class: 'station-loading station-error', role: 'alert' },
    h('p', null, 'This interactive station could not load.'),
    h('p', { class: 'small muted' }, 'Check the network connection, then try again.'),
    h('button', { class: 'btn', onclick: () => onRetry() }, 'Retry'),
  );
}

/** Beamline label with its sector or, in shared sectors, its station. */
export function beamlineTag(beamlineId: string | undefined): { label: string; color: string } | null {
  const m = beamlineId ? metaById(beamlineId) : undefined;
  if (!m) return null;
  const shared = FEATURE_META.some((o) => o.id !== m.id && o.sectorNumber === m.sectorNumber);
  const where = shared && !m.stations.includes(',') ? m.stations : `${m.sectorNumber}-ID`;
  return { label: `${BEAMLINES[m.id]?.acronym ?? m.id.toUpperCase()}, ${where}`, color: m.color };
}

/** Mount a station module into `host`. Returns a destroy function. */
export function mountStation(mod: ExplainerModule, host: HTMLElement, color: string, beamlineId?: string): () => void {
  const inst: ExplainerInstance = mod.mount(host, { color, beamlineId });
  return () => inst.destroy();
}

/** Opens one interactive station full-screen. Safe against double clicks and closing while the chunk loads. */
export function openExplainerModal(modal: Modal, id: string, color: string, beamlineId?: string): void {
  const tag = beamlineTag(beamlineId);
  const title = h('h2', { class: 'modal-title', id: 'station-modal-title', tabindex: '-1' }, 'Interactive station');
  const sub = h('p', { class: 'station-sub' });
  const host = h('div', { class: 'station-host station-host-full' });
  let alive = true;
  let destroy: (() => void) | null = null;
  let seq = 0;
  const load = async () => {
    const token = ++seq;
    // Retry removes the focused button: keep keyboard focus in the dialog (on its title) instead of <body>
    const refocus = host.contains(document.activeElement);
    host.replaceChildren(h('div', { class: 'station-loading' }, 'Loading interactive station…'));
    if (refocus) title.focus({ preventScroll: true });
    const mod = await loadExplainer(id);
    if (!alive || token !== seq) return; // closed, replaced or retried meanwhile
    if (!mod) {
      host.replaceChildren(loadErrorNotice(() => void load()));
      return;
    }
    title.textContent = mod.title;
    sub.textContent = mod.subtitle;
    modal.el.querySelector('.modal-box')?.setAttribute('aria-label', mod.title);
    host.replaceChildren();
    destroy = mountStation(mod, host, color, beamlineId);
  };
  modal.open(
    [
      h(
        'header',
        { class: 'modal-head' },
        h(
          'div',
          { class: 'modal-head-text' },
          h('div', { class: 'kicker' }, 'Interactive station', tag ? h('span', { class: 'kicker-bl', style: `color:${tag.color}` }, ` · ${tag.label}`) : null),
          title,
        ),
      ),
      sub,
      host,
    ],
    () => {
      alive = false;
      destroy?.();
      destroy = null;
    },
    'Interactive station',
    'station',
  );
  void load();
}
