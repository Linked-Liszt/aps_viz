"""Shrink design-record figures in public/figures: cap width at 1600 px and quantise to a 256-colour palette
(line drawings and plots survive this visually lossless at screen size). Usage:
  python3 scripts/compress-figures.py public/figures [--dry]
"""
import os, sys
from PIL import Image

root = sys.argv[1]
dry = '--dry' in sys.argv
before = after = 0
for dirpath, _, files in os.walk(root):
    for f in files:
        if not f.lower().endswith('.png'):
            continue
        p = os.path.join(dirpath, f)
        b = os.path.getsize(p)
        im = Image.open(p)
        im.load()
        if im.width > 1600:
            im = im.resize((1600, round(im.height * 1600 / im.width)), Image.LANCZOS)
        rgb = im.convert('RGB')
        q = rgb.quantize(colors=256, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE)
        out = p if not dry else p + '.tmp.png'
        q.save(out, optimize=True)
        a = os.path.getsize(out)
        if a >= b and not dry:  # keep the original if quantising did not help
            im.save(p, optimize=True) if im is not None else None
            a = os.path.getsize(p)
        if dry:
            os.remove(out)
        before += b
        after += min(a, b)
print(f'{before/1e6:.1f} MB -> {after/1e6:.1f} MB')
