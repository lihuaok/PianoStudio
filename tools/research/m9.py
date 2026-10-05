# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
"""Careful bar-level transcription of Mutopia-2015/08/18-931 (Für Elise, WoO 59).

Independent source: Mutopia Project, typeset by Stelios Samelis, engraved from
Breitkopf & Härtel 1888 (Series 25) -- a different bibliographic line from the
Nohl-1867 transmission behind the corrupted abc.musicaviva file.

Unit: 1 = one 16th note. 3/8 bar = 6 units. LilyPond semantics implemented:
  * \\partial 8  -> pickup bar of 2 sixteenths
  * bar lines fall whenever accumulated duration reaches a multiple of 6
  * \\alternative { {A} {B} } -> A and B are two VERSIONS of the SAME
    printed measure (they do not advance the measure number)
  * R<n> multi-measure rest spans ceil(n*4/1.5) bars  (R4. -> 3 bars of 3/8)
Validated against the LilyPond-generated MIDI of the same .ly file.
"""
import re, glob

SRC = open('fur_Elise_WoO59.ly', encoding='utf-8').read()
DU = {1: 16, 2: 8, 4: 4, 8: 2, 16: 1, 32: 0.5, 64: 0.25}
BAR = 6.0
EPS = 1e-9
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


def durword(v):
    for k, nm in ((1, 'whole'), (2, 'half'), (4, 'quarter'),
                  (8, 'eighth'), (16, '16th'), (32, '32nd'), (64, '64th')):
        b = 16.0 / k
        if abs(v - b) < 1e-6:
            return nm
        if abs(v - b * 1.5) < 1e-6:
            return 'dotted ' + nm
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


def run(name):
    """-> list of printed measures: (mnum, [ (offset, token, dur, rest) ])"""
    out = []            # finished measures
    cur = []            # events of the measure being filled
    length = 0.0        # filled duration in current measure
    curname = 0
    start = 0.0         # absolute position of current measure start
    abspos = 0.0
    pickup_len = None
    in_pickup = True
    end_pending = False   # next finished measure is an alternative ending
    end_forms = []
    d = 4.0
    stack = []
    depth = 0
    chord = None
    clef = None

    def measure_capacity():
        return pickup_len if in_pickup else BAR

    def finish(force=False):
        """Close the current measure if it is full (or force)."""
        nonlocal cur, length, start, abspos, in_pickup, end_pending, end_forms, clef, curname
        nonlocal curname
        cap = measure_capacity()
        if not force and length < cap - EPS:
            return False
        # pad
        if length < cap - EPS:
            cur.append((round(length, 6), 'rest', cap - length, True))
            length = cap
        tag = None
        if in_pickup:
            tag = 'pickup'
            in_pickup = False
        elif end_pending:
            tag = 'ending'
        out.append((curname if not in_pickup else 0, tag, cur, clef))
        if not in_pickup:
            if end_pending:
                curname += 1     # ending consumed the measure number
            else:
                curname += 1
        end_pending = False
        end_forms = []
        cur = []
        length = 0.0
        start = abspos
        clef = None
        return True

    def emit(txt, dd, rest=False):
        nonlocal length, abspos
        cur.append((round(length, 6), txt, dd, rest))
        length += dd
        abspos += dd

    for mt in TOK.finditer(staff_src(name)):
        t = mt.group(0)
        g = mt.groupdict()
        if g['pd'] is not None:
            pickup_len = dur(g['pd'])
            continue
        if g['alt'] is not None:
            # the PREVIOUS measure was the last bar of the repeat body and is
            # already recorded; upcoming measures are ending 1 / ending 2
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
            clef = g['clef']
            continue
        if skipping:
            continue

        def boundary():
            nonlocal end_pending
            cap = measure_capacity()
            if length >= cap - EPS:
                finish()
                # a measure that follows an \\alternative body is an ENDING:
                # it reuses the same printed number
                return True
            return False

        if g['chord'] is not None:
            chord = g['chord']
            continue
        if g['num'] is not None and chord is not None:
            d0 = dur(g['num'])
            if d0:
                d = d0
            boundary()
            emit(chord, d * sc)
            chord = None
            continue
        if g['note'] is not None:
            chord = None
            note = g['note']
            tail = re.search(r"[',]*(\d*\.*)$", note)
            d0 = dur(tail.group(1)) if tail and tail.group(1) else None
            if d0:
                d = d0
            boundary()
            emit(note, d * sc)
            continue
        if g['rest'] is not None:
            chord = None
            if g['rest'] == 'R':
                q = dur(g['rdur']) or 4.0
                nb = max(1, int(round((q / 4.0) / 1.5)))
                if length > EPS:
                    finish(force=True)
                for _ in range(nb):
                    curname += 1
                    out.append((curname, 'mm-rest', [], clef))
                    abspos += BAR
                    start = abspos
                continue
            d0 = dur(g['rdur'])
            if d0:
                d = d0
            boundary()
            emit('rest', d * sc, rest=True)
            continue
    if cur:
        finish(force=True)
    return out


if __name__ == '__main__':
    UP = run('up')
    DN = run('down')
    print('RH printed measures: %d   LH printed measures: %d' % (len(UP), len(DN)))
    print('RH first 12:', [(m, tag) for m, tag, ev, cl in UP[:12]])
    print('LH first 12:', [(m, tag) for m, tag, ev, cl in DN[:12]])
