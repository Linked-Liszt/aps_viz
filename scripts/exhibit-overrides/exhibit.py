"""Exhibit-copy layer shared by scripts/build-facility.py and scripts/build-sectors.py.

The research dossiers (research/*.json) are the fact-checked record and are never edited for presentation.
Visitor-facing wording (typography, plain-language rewrites, status phrasing, labels) lives in the JSON override
files next to this module and is applied by the build scripts, so src/data/*.json stays reproducible:

    python3 scripts/build-facility.py research/facility.json src/data/facility.json
    python3 scripts/build-sectors.py  research/sectors.json  src/data/sectors.json

Every override key must match something in the research data; a stale key is an error, not a silent no-op.
"""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    """Load scripts/exhibit-overrides/<name>, dropping '$comment' keys at any depth."""
    with open(os.path.join(HERE, name), encoding='utf-8') as f:
        return _strip_comments(json.load(f))


def _strip_comments(x):
    if isinstance(x, dict):
        return {k: _strip_comments(v) for k, v in x.items() if not k.startswith('$')}
    if isinstance(x, list):
        return [_strip_comments(v) for v in x]
    return x


def merge(base, patch):
    """Recursive dict merge; a None value in `patch` deletes the key."""
    out = dict(base or {})
    for k, v in patch.items():
        if v is None:
            out.pop(k, None)
        elif isinstance(v, dict) and isinstance(out.get(k), dict):
            out[k] = merge(out[k], v)
        else:
            out[k] = v
    return out


class OverrideError(Exception):
    pass


# ------------------------------------------------------------------ typography

_SUP = str.maketrans('0123456789-+', '⁰¹²³⁴⁵⁶⁷⁸⁹⁻⁺')
# ISO dates and document section numbers ("Sec. 4-10", "Table 2-3.1") keep their hyphens
_PROTECTED = re.compile(r'\b\d{4}-\d{2}(?:-\d{2})?(?:/\d{2})?\b|\b(?:Sec\.|Section|Chapter|Table|Fig\.|Figs\.)\s+\d+-\d+(?:\.\d+)*')


def _sup(s):
    return s.translate(_SUP)


def _sci(m):
    mant, exp = m.group(1), str(int(m.group(2)))
    return f'10{_sup(exp)}' if mant in ('1', '1.0') else f'{mant} × 10{_sup(exp)}'


def typo(s):
    """Exhibit typography for research shorthand (units, ×, ranges, exponents). Idempotent; leaves ISO dates, section numbers and beamline names alone."""
    if not isinstance(s, str):
        return s
    kept = []

    def keep(m):
        kept.append(m.group(0))
        return f"\x00{len(kept) - 1}\x00"

    s = _PROTECTED.sub(keep, s)
    s = s.replace('+/-', '±').replace('->', '→').replace(' - ', ' – ')
    s = re.sub(r'(?<![\w.])(\d+(?:\.\d+)?)e([+-]?\d+)\b', _sci, s)  # 5.1e12 -> 5.1 × 10¹²
    s = re.sub(r'(?<=\d)-(?=\d)', '–', s)  # numeric ranges 40-140 -> 40–140
    s = re.sub(r'\b(pm|nm)\.rad\b', '\\1·rad', s)
    s = re.sub(r'(\d)\s+1/A\b', '\\1 Å⁻¹', s)  # q 0.01-40 1/A -> 0.01–40 Å⁻¹
    s = re.sub(r'\bdelta-q\b', 'Δq', s)
    s = re.sub(r'\bLN2\b', 'LN₂', s)
    s = re.sub(r'\bum\b', 'µm', s)
    s = re.sub(r'\burad\b', 'µrad', s)
    s = re.sub(r'\^(-?\d+)', lambda m: _sup(m.group(1)), s)  # um^2, nm^-1
    s = re.sub(r'(\d)\s?deg\b', '\\1°', s)
    s = re.sub(r'([\d)])\s+x\s+(?=[\d(~])', '\\1 × ', s)  # 50 x 4, (h) x 3.7
    s = re.sub(r'(\d)x(?=\d)', '\\1×', s)  # 3x2
    s = re.sub(r'(\d)x\b', '\\1×', s)  # 10x, 2.5x
    s = re.sub(r'(?<![\w])x(?=\d)', '×', s)  # x540
    s = re.sub(r'\b(\d{1,3})(Fe|Kr|Eu|Dy|Sn)\b', lambda m: _sup(m.group(1)) + m.group(2), s)  # 57Fe -> ⁵⁷Fe
    return re.sub(r'\x00(\d+)\x00', lambda m: kept[int(m.group(1))], s)


def typo_all(x):
    if isinstance(x, str):
        return typo(x)
    if isinstance(x, list):
        return [typo_all(v) for v in x]
    if isinstance(x, dict):
        return {k: typo_all(v) for k, v in x.items()}
    return x


# ------------------------------------------------------------------ dates

_DATE_KEY = re.compile(r'(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?')


def date_key(d):
    """Sort key for timeline dates such as '2024-03-25/28', '2025-09 (late)', 'c. 2014'. Month-only sorts first."""
    m = _DATE_KEY.search(d or '')
    if not m:
        raise OverrideError(f'timeline date without a year: {d!r}')
    return tuple(int(g) if g else 0 for g in m.groups())
