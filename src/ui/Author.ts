import { h, icon } from '../lib/dom';
import { hasContent, renderMarkdown, stripComments } from '../lib/markdown';
import type { Modal } from './Modal';
// AUTHOR-OWNED CONTENT: src/author/*.md are written by the exhibit's author. AI agents and automated tools must not
// edit them (see AGENTS.md). This module only displays them.
import welcomeMd from '../author/welcome.md?raw';
import noteMd from '../author/note.md?raw';

/** Split a leading "# Title" off the Markdown (it becomes the dialog title). */
function titled(md: string, fallback: string): { title: string; body: string } {
  const text = stripComments(md).trim();
  const m = /^#\s+(.+)\n?/.exec(text);
  return m ? { title: m[1].trim(), body: text.slice(m[0].length) } : { title: fallback, body: text };
}

function page(md: string, fallback: string, heading?: string): { nodes: Node[]; title: string; content: HTMLElement } {
  const { title: sourceTitle, body } = titled(md, fallback);
  const title = heading ?? sourceTitle;
  const content = h('div', { class: 'author-md' });
  content.appendChild(renderMarkdown(body));
  return { title, content, nodes: [h('h2', { class: 'modal-title' }, title), content] };
}

/** The welcome dialog is available unless the author left src/author/welcome.md empty. */
export const hasWelcome = (): boolean => hasContent(welcomeMd);

/**
 * Display the author's welcome with tour and exploration choices. `onDismiss` runs when the welcome closes.
 * Closing the author's note returns to the welcome and its link without dismissing the welcome.
 */
export function openWelcome(modal: Modal, onDismiss: () => void, onTour: () => void): void {
  const { nodes, title, content } = page(welcomeMd, 'Welcome', 'From the author');
  let toNote = false;
  const tour = h('button', {
    class: 'btn btn-primary btn-lg',
    onclick: () => {
      modal.close();
      onTour();
    },
  }, icon('tour', 17), 'Start the guided tour');
  const explore = h('button', { class: 'btn btn-lg', onclick: () => modal.close() }, icon('ring', 17), 'Explore freely');
  const actions = h('div', { class: 'cta-row author-actions' }, tour, explore);
  const show = (focus: HTMLElement = tour) => {
    toNote = false;
    modal.open(
      [...nodes, actions],
      () => {
        if (!toNote) onDismiss();
      },
      title,
      'narrow',
    );
    requestAnimationFrame(() => {
      if (modal.isOpen && modal.el.contains(focus)) focus.focus({ preventScroll: true });
    });
  };
  for (const link of content.querySelectorAll<HTMLAnchorElement>('a[href="#author-note"]')) {
    link.setAttribute('aria-haspopup', 'dialog');
    link.addEventListener('click', (e) => {
      e.preventDefault();
      toNote = true;
      openAuthorNote(modal, () => show(link));
    });
  }
  show();
}

/** The "Author's note" page. */
export function openAuthorNote(modal: Modal, onClose?: () => void): void {
  const { nodes, title } = page(noteMd, "Author's note");
  modal.open(nodes, onClose, title, 'narrow');
}
