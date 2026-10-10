"""Distil the researched facility dossier into src/data/facility.json for the app.
Usage: python3 scripts/build-facility.py <research/facility.json> src/data/facility.json

Visitor-facing wording comes from scripts/exhibit-overrides/facility.json (see exhibit.py there); never hand-edit the output.
"""
import json, os, re, sys

sys.dont_write_bytecode = True  # keep scripts/exhibit-overrides free of __pycache__
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exhibit-overrides'))
from exhibit import OverrideError, date_key, load, merge, typo_all  # noqa: E402

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
CITE = re.compile(r"\s*[\(\[](?:r\d+[a-z]?|[a-z]+\d+[a-z0-9]*)(?:[,;]\s*(?:r\d+[a-z]?|[a-z]+\d+[a-z0-9]*))*[\)\]]")
def clean(x):
    if isinstance(x, str): return CITE.sub('', x).strip()
    if isinstance(x, list): return [clean(v) for v in x]
    if isinstance(x, dict): return {k: clean(v) for k, v in x.items()}
    return x
keep = {
    'ring': d.get('ring'),
    'lattice': {k: v for k, v in (d.get('lattice') or {}).items() if k in ('type', 'dipolesPerSector', 'magnetsPerSector', 'magnetsTotal', 'modules', 'reverseBends', 'totalBendingAngle', 'magnetStrength')},
    'brightness': {'definition': (d.get('brightness') or {}).get('definition'), 'statements': (d.get('brightness') or {}).get('statements')},
    'swapOut': d.get('swapOut'),
    'harmonicCavity': d.get('harmonicCavity'),
    'timeline': d.get('timeline'),
    'exhibitNumbers': d.get('exhibitNumbers'),
    'plainExplainers': d.get('plainExplainers'),
    'project': d.get('project'),
    'references': d.get('references'),
}
keep = clean(keep)

# ---- exhibit-copy overrides ------------------------------------------------
ov = load('facility.json')

nums = keep['exhibitNumbers'] or []
by_label = {n['label']: i for i, n in enumerate(nums)}
for label, patch in (ov.get('exhibitNumbers') or {}).items():
    if label not in by_label:
        raise OverrideError(f'exhibitNumbers override for unknown label {label!r}')
    i = by_label[label]
    nums[i] = None if patch is None else merge(nums[i], patch)
keep['exhibitNumbers'] = typo_all([n for n in nums if n is not None])

tl = keep['timeline'] or []
for date, patch in (ov.get('timeline') or {}).items():
    hits = [i for i, t in enumerate(tl) if t is not None and t['date'] == date]
    if len(hits) != 1:
        raise OverrideError(f'timeline override {date!r} matches {len(hits)} entries')
    tl[hits[0]] = None if patch is None else merge(tl[hits[0]], patch)
tl = [t for t in tl if t is not None] + list(ov.get('timelineAdd') or [])
tl.sort(key=lambda t: date_key(t['date']))  # stable: same-key entries keep research order
keep['timeline'] = [{**t, **typo_all({k: t[k] for k in ('event', 'plain') if k in t})} for t in tl]

ex = keep['plainExplainers'] or {}
for k, text in (ov.get('plainExplainers') or {}).items():
    if k not in ex:
        raise OverrideError(f'plainExplainers override for unknown key {k!r}')
    if text is None:
        ex.pop(k)
    else:
        ex[k] = text
keep['plainExplainers'] = {k: (typo_all(v) if not k.endswith(('_source', '_note')) else v) for k, v in ex.items()}

json.dump(keep, open(out, 'w'), indent=1)
print('timeline', len(keep['timeline']), 'numbers', len(keep['exhibitNumbers']))
