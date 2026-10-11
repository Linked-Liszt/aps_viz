/**
 * A small, safe Markdown subset for author-written pages (src/author/*.md): headings (#–###), paragraphs, bullet and
 * numbered lists, block quotes, horizontal rules, **bold**, *italic* / _italic_, `code`, fenced code blocks, [links](https://…) and hard
 * line breaks (a line ending in two spaces or a backslash). HTML comments are dropped; any other HTML is shown as
 * text, never interpreted.
 */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Remove <!-- comments --> (author instructions live in them). */
export function stripComments(md: string): string {
  return md.replace(/<!--[\s\S]*?(-->|$)/g, '');
}

/** True when the text has something to show once comments and whitespace are removed. */
export function hasContent(md: string): boolean {
  return stripComments(md).trim().length > 0;
}

function safeHref(url: string): string | null {
  const u = url.trim();
  if (/^(https?:|mailto:)/i.test(u) || /^[#/.]/.test(u)) return u;
  return null;
}

function inline(text: string): string {
  // code spans first, so their contents are not formatted
  const codes: string[] = [];
  let s = text.replace(/`([^`]+)`/g, (_, c: string) => `\u0000${codes.push(esc(c)) - 1}\u0000`);
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, label: string, href: string) => {
    const ok = safeHref(href.replace(/&amp;/g, '&'));
    if (!ok) return m;
    const ext = /^(https?:|mailto:)/i.test(ok);
    return `<a href="${esc(ok)}"${ext ? ' target="_blank" rel="noopener"' : ''}>${label}</a>`;
  });
  s = s
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*(?!\s)(.+?)\*(?![*\w])/g, '$1<em>$2</em>')
    .replace(/(^|[^\w])_(?!\s)(.+?)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/( {2,}|\\)\n/g, '<br>')
    .replace(/\n/g, ' ');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `<code>${codes[+i]}</code>`);
}

/** Render the Markdown subset to an HTML string (escaped; safe to assign to innerHTML). */
export function markdownToHtml(md: string): string {
  const lines = stripComments(md).replace(/\r\n?/g, '\n').split('\n');
  const out: string[] = [];
  let para: string[] = [];
  let list: { tag: 'ul' | 'ol'; items: string[] } | null = null;
  let quote: string[] = [];
  let fence: { marker: string; lines: string[] } | null = null;
  const flushCode = () => {
    if (fence) out.push(`<pre><code>${esc(fence.lines.join('\n'))}</code></pre>`);
    fence = null;
  };
  const flushPara = () => {
    if (para.length) out.push(`<p>${inline(para.join('\n'))}</p>`);
    para = [];
  };
  const flushList = () => {
    if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${inline(i)}</li>`).join('')}</${list.tag}>`);
    list = null;
  };
  const flushQuote = () => {
    if (quote.length) out.push(`<blockquote>${markdownToHtml(quote.join('\n'))}</blockquote>`);
    quote = [];
  };
  const flushAll = () => {
    flushPara();
    flushList();
    flushQuote();
  };
  for (const raw of lines) {
    const line = raw.replace(/\s+$/, (ws) => (ws.length >= 2 && !ws.includes('\t') ? '  ' : ''));
    const t = line.trim();
    if (fence) {
      if (new RegExp(`^${fence.marker[0]}{${fence.marker.length},}\\s*$`).test(t)) flushCode();
      else fence.lines.push(raw);
      continue;
    }
    const code = /^(`{3,}|~{3,})\s*[\w+-]*\s*$/.exec(t);
    if (code) {
      flushAll();
      fence = { marker: code[1], lines: [] };
      continue;
    }
    if (!t) {
      flushAll();
      continue;
    }
    const q = /^>\s?(.*)$/.exec(t);
    if (q) {
      flushPara();
      flushList();
      quote.push(q[1]);
      continue;
    }
    flushQuote();
    const hd = /^(#{1,3})\s+(.*)$/.exec(t);
    if (hd) {
      flushAll();
      const n = hd[1].length + 1; // # → h2: the dialog title is the page's h2
      out.push(`<h${n}>${inline(hd[2])}</h${n}>`);
      continue;
    }
    if (/^([-*_])(\s*\1){2,}$/.test(t)) {
      flushAll();
      out.push('<hr>');
      continue;
    }
    const ul = /^[-*+]\s+(.*)$/.exec(t);
    const ol = /^\d+[.)]\s+(.*)$/.exec(t);
    if (ul || ol) {
      flushPara();
      const tag = ul ? 'ul' : 'ol';
      if (!list || list.tag !== tag) {
        flushList();
        list = { tag, items: [] };
      }
      list.items.push((ul ?? ol)![1]);
      continue;
    }
    if (list && /^\s{2,}/.test(raw)) {
      // continuation of the previous list item
      list.items[list.items.length - 1] += `\n${t}`;
      continue;
    }
    flushList();
    para.push(line.trimStart());
  }
  flushCode();
  flushAll();
  return out.join('\n');
}

/** Render to DOM nodes. */
export function renderMarkdown(md: string): DocumentFragment {
  const tpl = document.createElement('template');
  tpl.innerHTML = markdownToHtml(md);
  return tpl.content;
}
