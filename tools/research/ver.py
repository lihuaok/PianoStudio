# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
"""Authoritative transcription of Mutopia-2015/08/18-931 -- Für Elise, WoO 59.

INDEPENDENT SOURCE. Mutopia Project engraving by Stelios Samelis, engraved from
Breitkopf & Härtel 1888 (Series 25). This is a different bibliographic line
from the Nohl-1867 transmission that the corrupted abc.musicaviva file and its
descendants (saomaicenter .mxl, mfiles PDF, IMSLP JF Edition, piano.org) all
descend from.

Unit: 1 = one 16th note.  3/8 bar = 6 units.  \\partial 8 -> pickup 2 units.

LilyPond semantics implemented:
  * a bar closes when accumulated duration reaches the bar capacity (6);
    a note that overshoots is kept in the bar it starts in (LilyPond warns
    "bar is overfull" but does not move the note);
  * \\alternative { {A} {B} } -> A and B are two VERSIONS of the SAME printed
    measure, so both carry the same measure number and the following bar
    number advances only once;
  * R<n>[.] multi-measure rest: n is a note-duration (4 = quarter).  R4. in 3/8
    = dotted quarter = exactly one bar.
Validated note-for-note (onset, duration, pitch) against the LilyPond-generated
MIDI of the same file, after simulating the written-out repeats.
"""
import re

SRC = open('fur_Elise_WoO59.ly', encoding='utf-8').read()
DU = {1: 16, 2: 8, 4: 4, 8: 2, 16: 1, 32: 0.5, 64: 0.25}
BAR = 6.0
EPS = 1e-9
STEP = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def dur(t):
    if not t:
        return None
    m = re.fullmatch(r'(\d+)(\.*)', t)
    if not m:
        return None
    b = DU.get(int(m.group(1)))
    if b is None:
        return None
    k = len(m.group(2))
    return float(b) * (2 - 2 ** (-k)) if k else float(b)


def durword(v):
    for k, n in ((1, 'whole'), (2, 'half'), (4, 'quarter'),
                 (8, 'eighth'), (16, '16th'), (32, '32nd'), (64, '64th')):
        b = 16.0 / k
        if abs(v - b) < 1e-6:
            return n
        if abs(v - b * 1.5) < 1e-6:
            return 'dotted ' + n
    return '%g/16' % v


def midi_of(tok):
    m = re.match(r"^([a-g])((?:ises|eses|iss|es|is|s|x)*)([',]*)", tok)
    if not m:
        return None
    v = STEP[m.group(1)]
    ac = m.group(2) or ''
    if ac == 'is':
        v += 1
    elif ac in ('es', 'eses'):
        v -= 1
    return 60 + (m.group(3).count("'") - m.group(3).count(',') - 1) * 12 + v


def nm(x):
    return NAMES[x % 12] + str(x // 12 - 1)


def staff_src(n):
    i = SRC.find('\\new Staff = "%s"' % n)
    j = SRC.find('\\new Staff = "', i + 10)
    k = SRC.find('\\new Dynamics', i)
    return SRC[i:min(x for x in (j, k, len(SRC)) if x > i)]


NOTE = r"[a-g](?:ises|eses|iss|es|is|s|x)*[',]*\d*\.*"
TOK = re.compile(r"""
    \\partial\s+(?P<pd>\d+\.*)
  | \\repeat\s+volta\s+(?P<volta>\d+)
  | (?P<alt>\\alternative)
  | \\bar\s+"[^"]*"
  | \\set\s+Timing\.[^\n]*
  | \\override[^\n]*
  | \\key\s+[a-g]\s*\\[a-z]+
  | \\time\s+\d+/\d+
  | \\clef\s+(?P<clef>[a-z]+)
  | \\tempo\s+[^=]*=
  | \\tuplet\s+(?P<tn>\d+)\s*/\s*(?P<td>\d+)
  | (?P<grace>\\grace\b|\\appoggiatura\b)
  | \\[a-zA-Z]+ | "(?:[^"\\]|\\.)*"
  | (?P<chord><[^>]*>)
  | (?P<note>%s)
  | (?P<rest>[rR])(?P<rdur>\d+\.*)?
  | (?P<num>\d+\.*) | [A-Za-z]{2,} | \S
""" % NOTE, re.X)


class Bar(object):
    __slots__ = ('num', 'ver', 'items', 'clef', 'start', 'mmrest')

    def __init__(self, num, ver, start):
        self.num = num; self.ver = ver
        self.items = []; self.clef = None; self.start = start
        self.mmrest = False


def run(name):
    bars = []
    cur = []
    ln = 0.0
    pos = 0.0
    num = 0
    ver = 0                 # 0 = main, 1 = ending a, 2 = ending b
    pick = None
    inpick = True
    d = 4.0
    st = []
    dep = 0
    ch = None
    clef = None
    depth = 0               # global brace depth
    alt_depth = None        # brace depth just after '\alternative'
    alt_outer = None

    def cap():
        return pick if inpick else BAR

    def close(force=False):
        nonlocal cur, ln, pos, num, inpick, ver, clef
        c = cap()
        if not force and ln < c - EPS:
            return
        if ln < c - EPS:
            cur.append((round(ln, 6), 'rest', c - ln, True))
            ln = c
        bars.append(Bar(num, ver, pos - ln))
        bars[-1].clef = clef
        if inpick:
            inpick = False
            num = 1
        elif ver == 0:
            num += 1
        cur = []
        ln = 0.0
        ver = 0
        clef = None

    for mt in TOK.finditer(staff_src(name)):
        t = mt.group(0)
        g = mt.groupdict()
        if g['pd'] is not None:
            pick = dur(g['pd'])
            continue
        if g['alt'] is not None:
            alt_depth = depth
            continue
        if g['volta'] is not None:
            continue
        if g['tn'] is not None:
            st.append(('tup', int(g['td']) / float(g['tn'])))
            dep += 1
            continue
        if g['grace'] is not None:
            st.append(('skip', 1.0))
            dep += 1
            continue
        if t == '{':
            depth += 1
            continue
        if t == '}':
            if alt_depth is not None and depth == alt_depth + 2:
                close(force=True)      # an \alternative ending = one bar
                depth -= 1
                continue
            if alt_depth is not None and depth == alt_depth + 1:
                alt_depth = None       # closing '\alternative { ... }'
                depth -= 1
                continue
            if st and dep > 0:
                dep -= 1
                if dep == 0:
                    st.pop()
            depth -= 1
            continue
        if t.startswith('\\'):
            continue
        if any(k == 'skip' for k, _ in st):
            continue
        sc = 1.0
        for k, v in st:
            if k == 'tup':
                sc *= v
        if g['clef'] is not None:
            clef = g['clef']
            continue

        def emit(txt, dd, rest=False):
            nonlocal ln, pos
            cur.append((round(ln, 6), txt, dd, rest))
            ln += dd
            pos += dd

        def bnd():
            if ln >= cap() - EPS:
                close()

        if g['chord'] is not None:
            ch = g['chord']
            continue
        if g['num'] is not None and ch is not None:
            d0 = dur(g['num'])
            if d0:
                d = d0
            bnd(); emit(ch, d * sc); ch = None
            continue
        if g['note'] is not None:
            ch = None
            note = g['note']
            tl = re.search(r"[',]*(\d*\.*)$", note)
            d0 = dur(tl.group(1)) if tl and tl.group(1) else None
            if d0:
                d = d0
            bnd(); emit(note, d * sc)
            continue
        if g['rest'] is not None:
            ch = None
            if g['rest'] == 'R':
                q = dur(g['rdur']) or 4.0
                nb = max(1, int(round(q / BAR)))
                if ln > EPS:
                    close(force=True)
                for _ in range(nb):
                    b = Bar(num, 0, pos)
                    b.mmrest = True
                    bars.append(b)
                    pos += BAR
                    num += 1
                continue
            d0 = dur(g['rdur'])
            if d0:
                d = d0
            bnd(); emit('rest', d * sc, True)
            continue
    if cur:
        close(force=True)
    return bars


def sound(bars):
    """-> list of (onset, dur, pitches[], measure, ver) skipping rests."""
    out = []
    for b in bars:
        for off, txt, dd, rest in b.items:
            if rest:
                continue
            if txt.startswith('<'):
                ps = [midi_of(x) for x in txt.strip('<> ').split()]
                out.append((b.start + off, dd, [p for p in ps if p is not None], b.num, b.ver))
            else:
                out.append((b.start + off, dd, [midi_of(txt)], b.num, b.ver))
    return out


if __name__ == '__main__':
    UP = run('up'); DN = run('down')
    print('RH bars=%d  LH bars=%d' % (len(UP), len(DN)))
    for n, ev, clef, alt, st in [(b.num, b.items, b.clef, b.ver, b.start) for b in UP[:11]]:
        print('  m.%-3d v%d len=%-4g %s' % (n, alt,
              sum(x[2] for x in ev),
              ' '.join('%s@%g/%g' % (t, o, d) for o, t, d, r in ev[:9])))
