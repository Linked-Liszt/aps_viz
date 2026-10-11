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

function page(md: string, fallback: string, kicker: string): { nodes: Node[]; title: string } {
  const { title, body } = titled(md, fallback);
  const content = h('div', { class: 'author-md' });
  content.appendChild(renderMarkdown(body));
  return { title, nodes: [h('div', { class: 'kicker' }, kicker), h('h2', { class: 'modal-title' }, title), content] };
}

/** The welcome dialog is shown on open unless the author left src/author/welcome.md empty. */
export const hasWelcome = (): boolean => hasContent(welcomeMd);

/**
 * The author's welcome message. `onDone` runs once it is dismissed by any means — or, when the visitor goes on to
 * the author's note from here, once that note is closed.
 */
export function openWelcome(modal: Modal, onDone: () => void): void {
  const { nodes, title } = page(welcomeMd, 'Welcome', 'From the author');
  let toNote = false;
  const cont = h('button', { class: 'btn btn-primary btn-lg', onclick: () => modal.close() }, 'Continue');
  modal.open(
    [
      ...nodes,
      h(
        'div',
        { class: 'cta-row author-actions' },
        cont,
        hasContent(noteMd) ? h('button', { class: 'btn btn-lg', onclick: () => ((toNote = true), openAuthorNote(modal, onDone)) }, icon('pen', 16), 'Read the author’s note') : null,
      ),
    ],
    () => {
      if (!toNote) onDone();
    },
    title,
    'narrow',
  );
  requestAnimationFrame(() => cont.focus({ preventScroll: true }));
}

/** The "Author's note" page. */
export function openAuthorNote(modal: Modal, onClose?: () => void): void {
  const { nodes, title } = page(noteMd, 'Author’s note', 'Author’s note');
  modal.open(nodes, onClose, title, 'narrow');
}
