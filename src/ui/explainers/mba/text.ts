/**
 * Canvas text with subscripts: "σ_{x}" / "σ_x" (one character) render the subscript smaller and lowered, so canvas
 * labels read like the kit's markdown captions instead of showing raw underscores. Uses the context's current
 * font (its px size is parsed from ctx.font) and fill style; textBaseline is respected for the main runs.
 */

interface Run {
  t: string;
  sub: boolean;
}

const cache = new Map<string, Run[]>();

function runs(s: string): Run[] {
  let r = cache.get(s);
  if (r) return r;
  r = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '_' && i + 1 < s.length) {
      if (buf) r.push({ t: buf, sub: false });
      buf = '';
      if (s[i + 1] === '{') {
        const j = s.indexOf('}', i + 2);
        const end = j < 0 ? s.length : j;
        r.push({ t: s.slice(i + 2, end), sub: true });
        i = end;
      } else {
        r.push({ t: s[i + 1], sub: true });
        i += 1;
      }
    } else buf += c;
  }
  if (buf) r.push({ t: buf, sub: false });
  if (cache.size > 400) cache.clear();
  cache.set(s, r);
  return r;
}

function fontParts(font: string): { pre: string; px: number; post: string } {
  const m = /(\d+(?:\.\d+)?)px/.exec(font);
  if (!m) return { pre: '', px: 11, post: font };
  return { pre: font.slice(0, m.index), px: Number(m[1]), post: font.slice(m.index + m[0].length) };
}

/** Width of a rich string in the current font. */
export function richWidth(ctx: CanvasRenderingContext2D, s: string): number {
  const rs = runs(s);
  if (rs.length === 1 && !rs[0].sub) return ctx.measureText(s).width;
  const base = ctx.font;
  const f = fontParts(base);
  const subFont = `${f.pre}${(f.px * 0.74).toFixed(1)}px${f.post}`;
  let w = 0;
  for (const r of rs) {
    ctx.font = r.sub ? subFont : base;
    w += ctx.measureText(r.t).width;
  }
  ctx.font = base;
  return w;
}

/** Draw a rich string; `align` is applied to the whole string. */
export function richText(ctx: CanvasRenderingContext2D, s: string, x: number, y: number, align: CanvasTextAlign = 'left'): void {
  const rs = runs(s);
  if (rs.length === 1 && !rs[0].sub) {
    const a = ctx.textAlign;
    ctx.textAlign = align;
    ctx.fillText(s, x, y);
    ctx.textAlign = a;
    return;
  }
  const base = ctx.font;
  const f = fontParts(base);
  const subFont = `${f.pre}${(f.px * 0.74).toFixed(1)}px${f.post}`;
  const w = richWidth(ctx, s);
  let cx = align === 'right' || align === 'end' ? x - w : align === 'center' ? x - w / 2 : x;
  const a = ctx.textAlign;
  ctx.textAlign = 'left';
  for (const r of rs) {
    ctx.font = r.sub ? subFont : base;
    ctx.fillText(r.t, cx, r.sub ? y + f.px * 0.28 : y);
    cx += ctx.measureText(r.t).width;
  }
  ctx.font = base;
  ctx.textAlign = a;
}
