"""Build src/data/site.json from the site research dossier, including OpenStreetMap building footprints.
Usage: python3 scripts/build-site.py <research/site.json> src/data/site.json
"""
import json, sys

src, out = sys.argv[1], sys.argv[2]
d = json.load(open(src))
ring = d['ring']
sec = d['sectors']
inj = d['injector']

def simplify(poly, tol=0.6):
    # Douglas-Peucker on a closed polygon, split at the vertex farthest from the first one
    if len(poly) < 5:
        return poly
    import math as _m
    far = max(range(len(poly)), key=lambda i: _m.dist(poly[0], poly[i]))
    return _dp_open(poly[: far + 1], tol)[:-1] + _dp_open(poly[far:] + [poly[0]], tol)[:-1]

def _dp_open(pts, tol):
    import math
    def dp(pts):
        if len(pts) < 3:
            return pts
        (x1, y1), (x2, y2) = pts[0], pts[-1]
        dx, dy = x2 - x1, y2 - y1
        L = math.hypot(dx, dy) or 1e-9
        best, idx = -1, 0
        for i in range(1, len(pts) - 1):
            x, y = pts[i]
            dist = abs(dy * x - dx * y + x2 * y1 - y2 * x1) / L
            if dist > best:
                best, idx = dist, i
        if best > tol:
            return dp(pts[: idx + 1])[:-1] + dp(pts[idx:])
        return [pts[0], pts[-1]]
    return dp(pts)

ROLE = {'ring': 'minor', 'office': 'office', 'conference': 'office', 'injector': 'injector', 'lom': 'lom', 'lbb': 'long-beamline-building', 'neighbour': 'neighbour'}
buildings = []
for b in d['buildings']:
    if b.get('role') == 'ring' or str(b.get('id')) == '400':
        continue  # the ring building is generated procedurally (tunnel + hall)
    poly = [[round(x, 2), round(y, 2)] for x, y in b['polygon']]
    if len(poly) > 3 and poly[0] == poly[-1]:
        poly = poly[:-1]
    name = b.get('name') or ''
    short = name.split(' - ')[0] if ' - ' in name else name
    if b.get('role') == 'lom':
        short = name.split(' - ')[0]
    buildings.append({
        'id': str(b.get('id')),
        'name': short,
        'fullName': name,
        'role': ROLE.get(b.get('role'), b.get('role') or 'other'),
        'polygon': poly if len(poly) <= 80 else simplify(poly),
        'heightM': b.get('heightGuessM') or 8,
    })

roads = []
for r in d.get('roads', []):
    pl = r.get('polyline') or []
    if len(pl) >= 2:
        roads.append({'name': r.get('name', ''), 'kind': r.get('highway', ''), 'polyline': [[round(x, 1), round(y, 1)] for x, y in pl]})

booster = inj['booster']
outlines = booster.get('outlinePolygon') or []
site = {
    'orbitRadiusM': ring['idStraightApothemM'],
    'orbitDrawRadiusM': ring['electronOrbitRadiusM'],
    'circumferenceM': 1104,
    'sectors': sec['count'],
    'sector1AngleDeg': sec['sector1AngleDeg'],
    'clockwise': 'clockwise' in sec['numberingDirection'],
    'injectionSector': sec.get('injectionSector', 39),
    'rfSectors': sec.get('rfSectors', []),
    'bunchLengtheningSector': sec.get('bunchLengtheningSector'),
    'tunnelInnerM': ring['hallInnerRadiusM'],
    'tunnelOuterM': ring['tunnelAndRatchetWall']['ratchetWallApproxRadiusM'],
    'ratchetFaceM': 23.8,
    'hallInnerM': ring['hallInnerRadiusM'],
    'hallOuterM': ring['hallOuterRadiusM'],
    'beamHeightM': 1.4,
    'buildings': buildings,
    'roads': roads,
    'injector': {
        'linac': [inj['linac']['axisEastEndXY'], inj['linac']['axisWestEndXY']],
        'par': {'center': inj['par']['centerXY'], 'radiusM': inj['par']['radiusM']},
        'booster': {'center': booster['centerXY'], 'radiusM': booster['radiusM'], 'outline': outlines},
        'bts': inj['bts']['polylineXYSchematic'],
    },
    'longBeamlines': d['longBeamlineBuilding'].get('beamlines', {}),
    'notes': [
        'Generated from the site dossier (OpenStreetMap footprints + APS/FDR documents); see research notes.',
        sec.get('sector1AngleDefinition', ''),
    ],
}
json.dump(site, open(out, 'w'), indent=1)
print(f"Wrote {len(buildings)} buildings and {len(roads)} roads. The sector 1 angle is {site['sector1AngleDeg']} degrees.")
