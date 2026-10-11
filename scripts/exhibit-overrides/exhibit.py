"""Exhibit-copy layer shared by scripts/build-facility.py and scripts/build-sectors.py.

The research dossiers (research/*.json) are the fact-checked record and are never edited for presentation.
Exhibit wording (typography, rewrites in the exhibit voice, status phrasing, labels) lives in the JSON override
files next to this module and is applied by the build scripts, so src/data/*.json stays reproducible:

    python3 scripts/build-facility.py research/facility.json src/data/facility.json
    python3 scripts/build-sectors.py  research/sectors.json  src/data/sectors.json

Every field has one text for all readers. Explain the subject in everyday words and define technical terms
where they appear. Preserve useful numbers, units and qualifications. `no_variants` rejects plain/expert
keys in an override. `check_text` checks displayed text for ASCII research notation, incomplete sentences
and references to the retired reading modes. Both functions raise OverrideError.

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
    s = s.replace('+/-', '±').replace('->', '→')
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
    s = s.translate(str.maketrans({'‘': "'", '’': "'", '“': '"', '”': '"'}))
    return re.sub(r'\x00(\d+)\x00', lambda m: kept[int(m.group(1))], s)


def typo_all(x):
    if isinstance(x, str):
        return typo(x)
    if isinstance(x, list):
        return [typo_all(v) for v in x]
    if isinstance(x, dict):
        return {k: typo_all(v) for k, v in x.items()}
    return x


# ------------------------------------------------------------------ one voice, linted

VARIANT_KEYS = ('plain', 'expert')


def no_variants(patch, where):
    """Overrides carry one unified text per field; a plain/expert pair (at any depth) is an error."""
    if isinstance(patch, dict):
        bad = [k for k in patch if k in VARIANT_KEYS]
        if bad:
            raise OverrideError(f'{where} contains {bad}. Write one text for all readers.')
        for k, v in patch.items():
            no_variants(v, f'{where}.{k}')


# Same patterns as ASCII_NOTATION in tests/data.test.ts and tests/copy.test.ts (re.ASCII mirrors JavaScript's \b).
ASCII_NOTATION = [
    ('um for µm', r'\d\s?um\b'),
    ('urad for µrad', r'\d\s?urad\b'),
    ('-> for →', r'\s->\s'),
    ('sqrt for √', r'\bsqrt'),
    ('deg for °', r'\d\s?deg\b'),
    ('e-notation for × 10ⁿ', r'\d(?:\.\d+)?e[-+]?\d+'),
    ('+/- for ±', r'\+/-'),
    ('ASCII * for × or ·', r'\s\*\s'),
    ('ASCII x between numbers', r'\d\s+x\s+\d'),
    ('bare caret power', r'\^(?!\{)'),
    ('mm2/nm2 for mm²/nm²', r'\b(?:mm|nm|µm|um)2\b'),
    ('spelled-out Greek', r'\b(?:sigma|theta|lambda)\b'),
]
_NOTATION = [(name, re.compile(rx, re.ASCII)) for name, rx in ASCII_NOTATION]
_MODE_WORDS = re.compile(r'\b(?:Visitor|Specialist)s?\b|(?i:\b(?:for specialists|expert mode|visitor mode|specialist mode)\b)')
_FRAGMENT_END = re.compile(r'\b(?:e\.g|i\.e|et al|cf|vs|approx|ca|Fig|Figs|Eq|Eqs|Ref|Refs|Sec)\.?$')


def _balanced(s):
    depth = {'(': 0, '[': 0}
    for c in s:
        if c in '([':
            depth[c] += 1
        elif c in ')]':
            depth['(' if c == ')' else '['] -= 1
            if min(depth.values()) < 0:
                return False
    return not any(depth.values())


def _sentence_problems(t):
    out = []
    first = t[:1]
    if not (first.isupper() or first.isdigit() or first in '“"‘(' or '\u0370' <= first <= '\u03ff'):
        out.append(f'starts mid-sentence: "{t[:20]}"')
    if not re.search(r'[.!?)][”"’\']*$', t):
        out.append(f'does not end a sentence: "…{t[-25:]}"')
    if _FRAGMENT_END.search(t):
        out.append(f'ends inside an abbreviation: "…{t[-25:]}"')
    return out


def check_text(items):
    """Lint displayed exhibit text. `items` is a list of (path, text, kind): kind 'prose' is whole sentences
    (paragraphs separated by one blank line), 'label' is a short fragment. Raises OverrideError listing every problem."""
    problems = []
    for path, text, kind in items:
        if not isinstance(text, str):
            continue
        found = [f'ASCII notation ({name}): "{m.group(0)}"' for name, rx in _NOTATION for m in [rx.search(text)] if m]
        if _MODE_WORDS.search(text):
            found.append(f'mentions a reading mode: "{_MODE_WORDS.search(text).group(0)}"')
        if text != text.strip():
            found.append('leading/trailing whitespace')
        if kind == 'prose':
            paras = text.split('\n\n')
            if len(text.strip()) < 20:
                found.append('empty or too short')
            for para in paras:
                if '\n' in para or re.search(r'\s{2,}', para) or not para:
                    found.append('stray line break or double space')
                found += _sentence_problems(para)
                if not _balanced(para):
                    found.append('unbalanced parentheses/brackets')
        elif re.search(r'\s{2,}|\n', text) or not _balanced(text):
            found.append('double space, line break or unbalanced brackets')
        problems += [f'{path}: {p}' for p in found]
    if problems:
        raise OverrideError('exhibit text problems:\n  ' + '\n  '.join(problems))


# ------------------------------------------------------------------ dates

_DATE_KEY = re.compile(r'(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?')


def date_key(d):
    """Sort key for timeline dates such as '2024-03-25/28', '2025-09 (late)', 'c. 2014'. Month-only sorts first."""
    m = _DATE_KEY.search(d or '')
    if not m:
        raise OverrideError(f'timeline date without a year: {d!r}')
    return tuple(int(g) if g else 0 for g in m.groups())
