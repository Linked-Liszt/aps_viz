import { describe, expect, it } from 'vitest';
import { hasContent, markdownToHtml } from '../src/lib/markdown';
import welcome from '../src/author/welcome.md?raw';
import note from '../src/author/note.md?raw';

describe('author Markdown', () => {
  it('renders the supported subset', () => {
    const html = markdownToHtml(
      '# Title\n\nOne **bold** and *it* and _it2_ with `a*b*c` and [APS](https://www.aps.anl.gov).\n\n- a\n- b\n\n1. x\n2. y\n\n> quoted\n\n---\n\nline one  \nline two',
    );
    expect(html).toContain('<h2>Title</h2>');
    expect(html).toContain('<strong>bold</strong>');
    expect(html).toContain('<em>it</em>');
    expect(html).toContain('<em>it2</em>');
    expect(html).toContain('<code>a*b*c</code>');
    expect(html).toContain('<a href="https://www.aps.anl.gov" target="_blank" rel="noopener">APS</a>');
    expect(html).toContain('<ul><li>a</li><li>b</li></ul>');
    expect(html).toContain('<ol><li>x</li><li>y</li></ol>');
    expect(html).toContain('<blockquote><p>quoted</p></blockquote>');
    expect(html).toContain('<hr>');
    expect(html).toContain('line one<br>line two');
  });

  it('never interprets HTML or unsafe links, and drops comments', () => {
    const html = markdownToHtml('<!-- hidden -->\n<script>alert(1)</script> [x](javascript:alert(1)) <img src=x onerror=y>');
    expect(html).not.toContain('hidden');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('href="javascript');
    expect(hasContent('<!-- only a comment -->\n\n')).toBe(false);
  });

  it('keeps snake_case and arithmetic intact', () => {
    const html = markdownToHtml('file_name_here and 2 * 3 * 4');
    expect(html).toBe('<p>file_name_here and 2 * 3 * 4</p>');
  });

  it('the author pages render (content is the author’s; only check that they parse)', () => {
    for (const md of [welcome, note]) expect(() => markdownToHtml(md)).not.toThrow();
  });
});
