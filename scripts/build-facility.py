"""Build src/data/facility.json from the research dossier and exhibit overrides.
Usage: python3 scripts/build-facility.py <research/facility.json> src/data/facility.json

Exhibit wording comes from scripts/exhibit-overrides/facility.json (see exhibit.py there); never hand-edit the output.
Output shapes (one unified text per item, no plain/expert variants):
  timeline[]        {date, event, source?, note?}
  exhibitNumbers[]  {label, value, explanation, source?, note?}
  explainers        {whatIsSynchrotron: text, ...}  (primer answers; research key `plainExplainers`; paragraphs are
                    separated by a blank line; `*_source` / `*_note` keys are research annotations, not shown)
Typography is applied to the displayed fields only; `source` and `note` keep the research wording.
"""
import json, os, re, sys

sys.dont_write_bytecode = True  # keep scripts/exhibit-overrides free of __pycache__
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exhibit-overrides'))
from exhibit import OverrideError, check_text, date_key, load, merge, no_variants, typo  # noqa: E402

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
    'explainers': d.get('plainExplainers'),
    'project': d.get('project'),
    'references': d.get('references'),
}
keep = clean(keep)

# ---- exhibit-copy overrides ------------------------------------------------
ov = load('facility.json')
no_variants(ov, 'facility overrides')

nums = keep['exhibitNumbers'] or []
by_label = {n['label']: i for i, n in enumerate(nums)}
for label, patch in (ov.get('exhibitNumbers') or {}).items():
    if label not in by_label:
        raise OverrideError(f'exhibitNumbers override for unknown label {label!r}')
    i = by_label[label]
    nums[i] = None if patch is None else merge(nums[i], patch)
NUM_SHOWN = ('label', 'value', 'explanation')
keep['exhibitNumbers'] = [
    {**{k: typo(n[k]) for k in NUM_SHOWN}, **{k: n[k] for k in ('source', 'note') if k in n}}
    for n in nums if n is not None
]

tl = keep['timeline'] or []
for date, patch in (ov.get('timeline') or {}).items():
    hits = [i for i, t in enumerate(tl) if t is not None and t['date'] == date]
    if len(hits) != 1:
        raise OverrideError(f'timeline override {date!r} matches {len(hits)} entries')
    tl[hits[0]] = None if patch is None else merge(tl[hits[0]], patch)
tl = [t for t in tl if t is not None] + list(ov.get('timelineAdd') or [])
tl.sort(key=lambda t: date_key(t['date']))  # stable: same-key entries keep research order
keep['timeline'] = [{'date': t['date'], 'event': typo(t['event']), **{k: t[k] for k in ('source', 'note') if k in t}} for t in tl]

ex = keep['explainers'] or {}
annotation = lambda k: k.endswith(('_source', '_note'))
for k, text in (ov.get('explainers') or {}).items():
    if k not in ex:
        raise OverrideError(f'explainers override for unknown key {k!r}')
    if text is None:
        ex.pop(k)
    else:
        ex[k] = text
unreviewed = [k for k in ex if not annotation(k) and k not in (ov.get('explainers') or {})]
if unreviewed:
    raise OverrideError(f'explainers without an exhibit-voice override (research wording would leak through): {unreviewed}')
keep['explainers'] = {k: (v if annotation(k) else typo(v)) for k, v in ex.items()}

# ---- lint everything the story dialog shows ---------------------------------
shown = []
for i, n in enumerate(keep['exhibitNumbers']):
    shown += [(f'exhibitNumbers[{i}].label', n['label'], 'label'), (f'exhibitNumbers[{i}].value', n['value'], 'label'),
              (f'exhibitNumbers[{i}].explanation', n['explanation'], 'prose')]
shown += [(f'timeline[{i}].event', t['event'], 'prose') for i, t in enumerate(keep['timeline'])]
shown += [(f'explainers.{k}', v, 'prose') for k, v in keep['explainers'].items() if not annotation(k)]
check_text(shown)

json.dump(keep, open(out, 'w'), indent=1)
print(f"Wrote {len(keep['timeline'])} timeline entries, {len(keep['exhibitNumbers'])} number cards and {sum(not annotation(k) for k in keep['explainers'])} primer answers.")
