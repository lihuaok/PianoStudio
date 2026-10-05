# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
"""Definitive bar-level parser for Mutopia fur_Elise_WoO59.ly
(independent engraving: typeset by Stelios Samelis, Mutopia-2015/08/18-931,
 engraved from Breitkopf & Härtel 1888 -- NOT the Nohl/ABC lineage).

Unit: 1 = one 16th note.  3/8 bar = 6 units.  \\partial 8 -> pickup = 2 units.
Every measure is padded to exactly 6 units (LilyPond behaviour), which is why
short first-endings do not shift the following bar numbers.
Multi-measure rest R<n>: n whole-note units -> bars = ceil(n*4 / 1.5).
  R4. -> 4.5 quarters -> exactly 3 bars of 3/8.
"""
import re, glob

SRC = open('fur_Elise_WoO59.ly', encoding='utf-8').read()
DU = {1: 16, 2: 8, 4: 4, 8: 2, 16: 1, 32: 0.5, 64: 0.25}
BAR = 6.0
EPS = 1e-9

NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
STEP = {'c': 0, 'd': 2, 'e': 4, 'f': 5, 'g': 7, 'a': 9, 'b': 11}


def dur(t):
    if not t:
        return None
    m = re.fullmatch(r'(\d+)(\.*)', t)
    if not m:
        return None
    b = DU.get(int(m.group(1)))
    if b is None:
        return None
    d = len(m.group(2))
    return float(b) * (2 - 2 ** (-d)) if d else float(b)


def pitch(tok):
    m = re.match(r"^([a-g])(is|es|eses|s|x)*([',]*)", tok)
    if not m:
        return None
    v = STEP[m.group(1)]
    ac = m.group(2) or ''
    if ac == 'is':
        v += 1
    elif ac in ('es', 'eses'):
        v -= 1
    oct_ = m.group(3).count("'") - m.group(3).count(',')
    return v + 12 * (oct_ + 1)


def staff_src(name):
    i = SRC.find('\\new Staff = "%s"' % name)
    j = SRC.find('\\new Staff = "', i + 10)
    k = SRC.find('\\new Dynamics', i)
    return SRC[i:min(x for x in (j, k, len(SRC)) if x > i)]


NOTE = r"[a-g](?:ises|eses|iss|es|is|s|x)*[',]*\d*\.*"
TOK = re.compile(r"""
    \\partial\s+(?P<pd>\d+\.*)
  | \\repeat\s+volta\s+\d+
  | (?P<alt>\\alternative)
  | \\bar\s+"(?P<bar>\"[^\"]*\")?"
  | \\set\s+Timing\.[^\n]*
  | \\override[^\n]*
  | \\key\s+[a-g]\s*\\[a-z]+
  | \\time\s+\d+/\d+
  | \\clef\s+(?P<clef>[a-z]+)
  | \\tempo\s+[^=]*=
  | \\tuplet\s+(?P<tn>\d+)\s*/\s*(?P<td>\d+)
  | (?P<grace>\\grace\b|\\appoggiatura\b)
  | \\[a-zA-Z]+
  | "(?:[^"\\]|\\.)*"
  | (?P<chord><[^>]*>)
  | (?P<note>%s)
  | (?P<rest>[rR])(?P<rdur>\d+\.*)?
  | (?P<num>\d+\.*)
  | (?P<skip>[A-Za-z]{2,})
  | \S
""" % NOTE, re.X)

DURWORD = {1: 'whole', 2: 'half', 4: 'quarter', 8: 'eighth', 16: '16th',
           32: '32nd', 64: '64th'}


def durword(v):
    for k, nm in DURWORD.items():
        base = 16.0 / k
        if abs(v - base) < 1e-6:
            return nm
        if abs(v - base * 1.5) < 1e-6:
            return 'dotted-' + nm
        if abs(v - base * 0.75) < 1e-6:
            return nm.replace('th', '') + 'dot'
        if abs(v - base * 0.5) < 1e-6:
            return 'half-' + nm
    return '%g/16' % v


class M(object):
    """One measure."""
    def __init__(self, num, kind):
        self.num = num; self.kind = kind
        self.items = []      # (offset, text, dur, is_rest)
        self.len = 0.0
        self.clef = None

    def add(self, text, d, rest=False, grace=False):
        self.items.append((round(self.len, 6), text, d, rest, grace))
        self.len += d

    def pad_to(self, n):
        if self.len < n - EPS:
            self.items.append((round(self.len, 6), 'r(pad)', n - self.len, True, False))
            self.len = n


def run(name):
    ms = []
    cur = 4.0
    stack = []
    depth = 0
    chord = None
    num = 0
    pickup_len = 2.0
    in_pickup = True
    m = M(0, 'pickup')

    def close():
        nonlocal m, num, in_pickup
        if in_pickup:
            m.pad_to(pickup_len)
            ms.append(m)
            in_pickup = False
            num += 1
            m = M(num, 'bar')
            return
        m.pad_to(BAR)
        ms.append(m)
        num += 1
        m = M(num, 'bar')

    for mt in TOK.finditer(staff_src(name)):
        t = mt.group(0)
        g = mt.groupdict()
        if g['pd'] is not None:
            pickup_len = dur(g['pd'])
            m.len = 0.0
            m.kind = 'pickup'
            continue
        if g['alt'] is not None:
            continue
        if g['tn'] is not None:
            stack.append(('tup', int(g['td']) / float(g['tn'])))
            depth += 1
            continue
        if g['grace'] is not None:
            stack.append(('skip', 1.0))
            depth += 1
            continue
        if t == '{':
            continue
        if t == '}':
            if stack and depth > 0:
                depth -= 1
                if depth == 0:
                    stack.pop()
            continue
        if g['bar'] is not None:
            if t in ('"|."', '"|."'):
                pass
            continue
        if t.startswith('\\'):
            continue
        skipping = any(k == 'skip' for k, _ in stack)
        sc = 1.0
        for k, v in stack:
            if k == 'tup':
                sc *= v
        if g['clef'] is not None:
            m.clef = g['clef']
            continue
        if skipping:
            continue

        if g['chord'] is not None:
            chord = g['chord']
            continue
        if g['num'] is not None and chord is not None:
            d0 = dur(g['num'])
            if d0:
                cur = d0
            m.add(chord, cur * sc)
            chord = None
            if m.len >= (pickup_len if in_pickup else BAR) - EPS:
                close()
            continue
        if g['note'] is not None:
            chord = None
            note = g['note']
            tail = re.search(r"[',]*(\d*\.*)$", note)
            d0 = dur(tail.group(1)) if tail and tail.group(1) else None
            if d0:
                cur = d0
            m.add(note, cur * sc)
            if m.len >= (pickup_len if in_pickup else BAR) - EPS:
                close()
            continue
        if g['rest'] is not None:
            chord = None
            if g['rest'] == 'R':
                q = dur(g['rdur']) or 4.0
                nb = max(1, int(round((q / 4.0) / 1.5)))
                if m.len > EPS:
                    close()
                for _ in range(nb):
                    m.add('R', BAR, rest=True)
                    close()
                continue
            d0 = dur(g['rdur'])
            if d0:
                cur = d0
            m.add('r', cur * sc, rest=True)
            if m.len >= (pickup_len if in_pickup else BAR) - EPS:
                close()
            continue
    if m.items:
        if not in_pickup:
            m.pad_to(BAR)
        ms.append(m)
    return ms


def fmt(m, lo, hi, label):
    print('\n' + '=' * 74)
    print(label)
    print('=' * 74)
    for mm in ms:
        pass
    return


if __name__ == '__main__':
    UP = run('up'); DN = run('down')
    print('MEASURE COUNT  RH=%d  LH=%d  (incl. pickup bar)' % (len(UP), len(DN)))
    bad = [m.num for m in UP if m.kind == 'bar' and abs(m.len - BAR) > EPS]
    print('RH measures not summing to 6:', bad[:10])
    bad2 = [m.num for m in DN if m.kind == 'bar' and abs(m.len - BAR) > EPS]
    print('LH measures not summing to 6:', bad2[:10])
