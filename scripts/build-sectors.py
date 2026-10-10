"""Convert the researched all-sector directory into src/data/sectors.json.
Usage: python3 scripts/build-sectors.py <research/sectors.json> src/data/sectors.json

Visitor-facing wording (plain labels, titles, status phrasing) comes from scripts/exhibit-overrides/sectors.json
(see exhibit.py there); never hand-edit the output.
"""
import json, os, re, sys

sys.dont_write_bytecode = True  # keep scripts/exhibit-overrides free of __pycache__
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), 'exhibit-overrides'))
from exhibit import OverrideError, load, merge, typo  # noqa: E402

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
CITE = re.compile(r"\s*[\(\[](?:r\d+[a-z]?(?:[,;]\s*)?)+[\)\]]")
clean = lambda s: CITE.sub('', s).strip() if isinstance(s, str) else s

sectors = {}
for s in d.get('sectors', []):
    n = int(s['sector'])
    bls = []
    for b in s.get('beamlines', []):
        enh = b.get('enhancement') or None
        if isinstance(enh, dict):
            enh = {k: clean(v) for k, v in enh.items()}
        st = b.get('status2026') or {}
        bls.append({
            'name': b.get('name', ''),
            'title': clean(b.get('directoryTitle', '')),
            'summary': clean(b.get('summaryPlain', '')),
            'url': b.get('directoryUrl', ''),
            'status': st.get('chartStageName') or st.get('directoryStatus') or '',
            'type': b.get('type', 'ID'),
            'stations': b.get('stations', []),
            'operator': clean(b.get('operator', '')),
            'techniques': [clean(t) for t in b.get('techniques', [])][:6],
            'feature': bool(b.get('feature')),
            'enhanced': bool(b.get('enhanced')),
            'enhancement': enh,
            'notes': clean(b.get('notes', '')),
        })
    sectors[n] = {
        'sector': n,
        'lom': s.get('lomBuilding', ''),
        'canted': bool(s.get('cantedAsBuilt')),
        'operators': clean(s.get('operators', '')),
        'id': any(b['type'] == 'ID' for b in bls),
        'bm': any(b['type'] == 'BM' for b in bls),
        'beamlines': bls,
    }
for n in range(1, 41):
    sectors.setdefault(n, {'sector': n, 'id': n <= 35, 'bm': n <= 35, 'beamlines': []})

# ---- exhibit-copy overrides ------------------------------------------------
for key, patch in load('sectors.json')['sectors'].items():
    n = int(key)
    if n not in sectors or not sectors[n]['beamlines']:
        raise OverrideError(f'sector override {key}: no such sector with beamlines')
    sec = sectors[n]
    patch = dict(patch)
    bl_patches = patch.pop('beamlines', {})
    enh_patch = patch.pop('enhancement', None)
    for k, v in patch.items():
        if k not in ('plainLabel', 'operators'):
            raise OverrideError(f'sector override {key}: unsupported field {k!r}')
        sec[k] = v
    if enh_patch:
        hits = [b for b in sec['beamlines'] if b['enhanced'] and isinstance(b['enhancement'], dict)]
        if not hits:
            raise OverrideError(f'sector override {key}: enhancement patch but no enhanced beamline')
        for b in hits:
            b['enhancement'] = merge(b['enhancement'], enh_patch)
    for name, bp in bl_patches.items():
        hits = [i for i, b in enumerate(sec['beamlines']) if b['name'] == name]
        if len(hits) != 1:
            raise OverrideError(f'sector override {key}: beamline {name!r} matches {len(hits)}')
        sec['beamlines'][hits[0]] = merge(sec['beamlines'][hits[0]], bp)
missing = [n for n, s in sectors.items() if any(b['enhanced'] for b in s['beamlines']) and not s.get('plainLabel')]
if missing:
    raise OverrideError(f'enhanced sectors without a plainLabel: {missing}')

# ---- exhibit typography on displayed text -----------------------------------
for s in sectors.values():
    if s.get('operators'):
        s['operators'] = typo(s['operators'])
    for b in s['beamlines']:
        for k in ('title', 'summary', 'operator'):
            b[k] = typo(b[k])
        b['techniques'] = [typo(t) for t in b['techniques']]
        if isinstance(b['enhancement'], dict):
            for k in ('plain', 'expert'):
                if k in b['enhancement']:
                    b['enhancement'][k] = typo(b['enhancement'][k])

summary = d.get('summary') or {}
json.dump({'sectors': sectors, 'summary': {'headline': clean(summary.get('headline', '')) if isinstance(summary, dict) else ''}, 'references': d.get('references', [])}, open(out, 'w'), indent=1)
print('sectors', len(sectors), 'enhanced', sum(b['enhanced'] for s in sectors.values() for b in s['beamlines']))
