# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
"""Authoritative bar model for Mutopia-2015/08/18-931 (Für Elise, WoO 59).

Source: Mutopia Project engraving by Stelios Samelis, engraved from
Breitkopf & Härtel 1888 -- an INDEPENDENT lineage from the Nohl-1867
transmission that the corrupted abc.musicaviva file derives from.

Unit: 1 = one 16th note.  3/8 bar = 6 units.  \\partial 8 -> pickup = 2 units.
LilyPond semantics that matter here:
  * every non-pickup measure is padded to exactly 6 units;
  * \\alternative { {1st} {2nd} } -> the two endings are SEPARATE bars;
  * multi-measure rest R<n> spans ceil(n*4/1.5) bars  (R4. -> 3 bars of 3/8).
Validated note-for-note against the LilyPond-generated MIDI of the same file.
"""
import re, glob

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
    d = len(m.group(2))
    return float(b) * (2 - 2 ** (-d)) if d else float(b)


def durword(v):
    for k, nm in ((1, 'whole'), (2, 'half'), (4, 'quarter'),
                  (8, 'eighth'), (16, '16th'), (32, '32nd'), (64, '64th')):
        base = 16.0 / k
        if abs(v - base) < 1e-6:
            return nm
        if abs(v - base * 1.5) < 1e-6:
            return 'dotted ' + nm
    return '%g/16' % v


def midi_of(tok):
    m = re.match(r"^([a-g])(is|es|eses|iss|s|x)*([',]*)(?:\d|\.)", tok + '4')
    if not m:
        m = re.match(r"^([a-g])(is|es|eses|iss|s|x)*([',]*)", tok)
    if not m:
        return None
    v = STEP[m.group(1)]
    ac = m.group(2) or ''
    if ac == 'is':
        v += 1
    elif ac in ('es', 'eses'):
        v -= 1
    oct_ = m.group(3).count("'") - m.group(3).count(',')
    return 60 + (oct_ - 1) * 12 + v


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
  | \\bar\s+"[^"]*"
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
  | (?P<w>[A-Za-z]{2,})
  | \S
""" % NOTE, re.X)


class Bar(object):
    def __init__(self, num, tag, tlen):
        self.num = num; self.tag = tag
        self.items = []; self.len = 0.0; self.clef = None; self.tlen = tlen

    def add(self, txt, d, rest=False):
        self.items.append((round(self.len, 6), txt, d, rest))
        self.len += d

    def pad(self):
        if self.len < self.tlen - EPS:
            self.items.append((round(self.len, 6), 'rest', self.tlen - self.len, True))
            self.len = self.tlen


def run(name):
    bars = []
    cur_dur = 4.0
    stack = []
    depth = 0
    chord = None
    num = -1
    pickup_len = None
    b = None
    alt_pending = 0          # 0 none, 1 next bar starts an alternative

    def newbar(first=False, tag='bar', tlen=None):
        nonlocal b, num
        if first:
            b = Bar(0, 'pickup', tlen)
        else:
            num += 1
            b = Bar(num, tag, tlen or BAR)

    def close():
        nonlocal b
        b.pad()
        bars.append(b)

    newbar(first=True, tlen=2.0)
    for mt in TOK.finditer(staff_src(name)):
        t = mt.group(0)
        g = mt.groupdict()
        if g['pd'] is not None:
            pickup_len = dur(g['pd'])
            b.tlen = pickup_len
            continue
        if g['alt'] is not None:
            alt_pending = 1
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
        if t.startswith('\\'):
            continue
        skipping = any(k == 'skip' for k, _ in stack)
        sc = 1.0
        for k, v in stack:
            if k == 'tup':
                sc *= v
        if g['clef'] is not None:
            b.clef = g['clef']
            continue
        if skipping:
            continue

        # a bar boundary can fall before this event
        def boundary():
            nonlocal b, alt_pending, num
            if b.len >= b.tlen - EPS:
                close()
                num_end = num
                tag = 'bar'
                if alt_pending == 1:
                    tag = 'ending-1'
                    alt_pending = 2
                elif alt_pending == 2:
                    tag = 'ending-2'
                    alt_pending = 0
                num += 1
                b = Bar(num, tag, BAR)

        if g['chord'] is not None:
            chord = g['chord']
            continue
        if g['num'] is not None and chord is not None:
            d0 = dur(g['num'])
            if d0:
                cur_dur = d0
            boundary()
            b.add(chord, cur_dur * sc)
            chord = None
            continue
        if g['note'] is not None:
            chord = None
            note = g['note']
            tail = re.search(r"[',]*(\d*\.*)$", note)
            d0 = dur(tail.group(1)) if tail and tail.group(1) else None
            if d0:
                cur_dur = d0
            boundary()
            b.add(note, cur_dur * sc)
            continue
        if g['rest'] is not None:
            chord = None
            if g['rest'] == 'R':
                q = dur(g['rdur']) or 4.0
                nb = max(1, int(round((q / 4.0) / 1.5)))
                if b.len > EPS:
                    close()
                    num += 1
                    b = Bar(num, 'bar', BAR)
                for _ in range(nb):
                    b.add('R', BAR, rest=True)
                    close()
                    num += 1
                    b = Bar(num, 'bar', BAR)
                continue
            d0 = dur(g['rdur'])
            if d0:
                cur_dur = d0
            boundary()
            b.add('rest', cur_dur * sc, rest=True)
            continue
    if b.items:
        close()
    return bars


def flat(bars):
    out = []
    t = 0.0
    for b in bars:
        for off, txt, d, rest in b.items:
            if not rest:
                out.append((round(t + off, 6), d, txt, b.num, b.tag))
        t += b.len
    return out, t


if __name__ == '__main__':
    import lyx
    UP = run('up'); DN = run('down')
    U, tU = flat(UP); L, tL = flat(DN)
    mid = glob.glob('*.mid')[0]
    mnR = lyx.midi_notes(mid, 1)
    mnL = lyx.midi_notes(mid, 2)
    print('bar model: RH %d bars, LH %d bars' % (len(UP), len(DN)))
    print('notes: RH %d, LH %d' % (len(U), len(L)))
    for tag, model, mn, off in (('RH', U, mnR, 0.0), ('LH', L, mnL, 0.0)):
        mm = [(p / 4.0, d / 4.0, t) for p, d, t, _, _ in model]
        n = min(len(mm), len(mn))
        ok = 0
        firstbad = None
        for i in range(n):
            good = (abs(mm[i][0] + off - mn[i][0]) < 0.011 and
                    abs(mm[i][1] - mn[i][1]) < 0.011 and
                    midi_of(mm[i][2]) == midi_of(mn[i][2]))
            if good:
                ok += 1
            elif firstbad is None:
                firstbad = (i, (round(mm[i][0], 3), mm[i][1], mm[i][2]),
                            (round(mn[i][0], 3), mn[i][1], mn[i][2]))
        print('%s: %d/%d exact vs MIDI%s' % (tag, ok, n,
              '' if firstbad is None else '  first mismatch %s' % (firstbad,)))
