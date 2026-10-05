# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
"""(midi_notes returns ticks/div = QUARTERS.)
Exact parser for Mutopia fur_Elise_WoO59.ly, cross-validated note-for-note
against the LilyPond-generated MIDI of the same file.

Units: 1 = one 16th note.  3/8 bar = 6 units (= 1.5 quarters).
LilyPond multi-measure rest R<n>: duration n is in whole-note fractions;
a 3/8 bar = 1.5 quarters, so bars = ceil(quarters / 1.5).
  R4. -> 1.5 quarters -> 1 bar ;  R4 -> 1 quarter -> 1 bar ;  R2 -> 2 bars.
"""
import re, struct, glob, math

SRC = open('fur_Elise_WoO59.ly', encoding='utf-8').read()
DU = {1: 16, 2: 8, 4: 4, 8: 2, 16: 1, 32: 0.5, 64: 0.25}
BAR = 6.0
QPB = 1.5                      # quarters per 3/8 bar


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


def staff_src(name):
    i = SRC.find('\\new Staff = "%s"' % name)
    j = SRC.find('\\new Staff = "', i + 10)
    k = SRC.find('\\new Dynamics', i)
    return SRC[i:min(x for x in (j, k, len(SRC)) if x > i)]


NOTE = r"[a-g](?:ises|eses|iss|es|is|s|x)*[',]*\d*\.*"
TOK = re.compile(r"""
    \\partial\s+\d+\.*
  | \\repeat\s+volta\s+\d+
  | \\alternative
  | \\bar\s+"[^"]*"
  | \\set\s+Timing\.[^\n]*
  | \\override[^\n]*
  | \\key\s+[a-g]\s*\\[a-z]+
  | \\time\s+\d+/\d+
  | \\clef\s+[a-z]+
  | \\tempo\s+[^=]*=
  | \\tuplet\s+(?P<tn>\d+)\s*/\s*(?P<td>\d+)
  | \\grace\b | \\appoggiatura\b
  | \\[a-zA-Z]+
  | "(?:[^"\\]|\\.)*"
  | (?P<chord><[^>]*>)
  | (?P<note>%s)
  | (?P<rest>[rR])(?P<rdur>\d+\.*)?
  | (?P<num>\d+\.*)
  | [A-Za-z]{2,}
  | \S
""" % NOTE, re.X)


class P(object):
    def __init__(self):
        self.stack = []
        self.depth = 0
        self.cur = 4.0
        self.t = 0.0
        self.out = []
        self.chord = None
        self.warn = []

    def scale(self):
        s = 1.0
        for k, v in self.stack:
            if k == 'tup':
                s *= v
        return s

    def skipping(self):
        return any(k == 'skip' for k, _ in self.stack)

    def put(self, tok, d):
        self.out.append((round(self.t, 6), round(d, 6), tok))
        self.t += d


def run(name):
    p = P()
    p.t = 0.0
    for m in TOK.finditer(staff_src(name)):
        t = m.group(0)
        g = m.groupdict()
        if g['tn'] is not None:
            p.stack.append(('tup', int(g['td']) / float(g['tn'])))
            p.depth += 1
            continue
        if t in ('\\grace', '\\appoggiatura'):
            p.stack.append(('skip', 1.0))
            p.depth += 1
            continue
        if t == '{':
            continue
        if t == '}':
            if p.stack and p.depth > 0:
                p.depth -= 1
                if p.depth == 0:
                    p.stack.pop()
            continue
        if t.startswith('\\'):
            continue
        if p.skipping():
            continue
        sc = p.scale()

        if g['chord'] is not None:
            p.chord = g['chord']
            continue
        if g['num'] is not None and p.chord is not None:
            d = (dur(g['num']) or p.cur) * sc
            p.cur = d
            p.put(p.chord, d)
            p.chord = None
            continue
        if g['note'] is not None:
            p.chord = None
            note = g['note']
            tail = re.search(r"[',]*(\d*\.*)$", note)
            d0 = dur(tail.group(1)) if tail and tail.group(1) else None
            if d0:
                p.cur = d0
            p.put(note, p.cur * sc)
            continue
        if g['rest'] is not None:
            p.chord = None
            if g['rest'] == 'R':
                q16 = dur(g['rdur']) or 4.0
                nb = max(1, int(math.ceil((q16 / 4.0) / QPB - 1e-9)))
                p.put('R%d-bar-multimeasure-rest(%d bars)' % (len(str(g['rdur'] or '4')), nb), nb * BAR)
                continue
            d0 = dur(g['rdur'])
            if d0:
                p.cur = d0
            p.t += p.cur * sc
            continue
    return p


def midi_notes(path, tr):
    d = open(path, 'rb').read()
    pos = 8 + struct.unpack('>I', d[4:8])[0]
    div = struct.unpack('>H', d[12:14])[0]
    NM = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

    def vlq(b, i):
        v = 0
        while True:
            c = b[i]; i += 1; v = (v << 7) | (c & 0x7f)
            if not c & 0x80:
                return v, i
    t = 0
    while pos < len(d):
        ln = struct.unpack('>I', d[pos + 4:pos + 8])[0]
        body = d[pos + 8:pos + 8 + ln]; pos += 8 + ln
        if t != tr:
            t += 1
            continue
        i = 0; tk = 0; run_ = None; on = {}; out = []
        while i < len(body):
            dt, i = vlq(body, i); tk += dt; st = body[i]
            if st < 0x80:
                st = run_
            else:
                i += 1; run_ = st
            if st == 0xFF:
                mt = body[i]; i += 1; l, i = vlq(body, i); i += l
            elif st in (0xF0, 0xF7):
                l, i = vlq(body, i); i += l
            else:
                hi = st & 0xF0
                if hi in (0x80, 0x90, 0xA0, 0xB0, 0xE0):
                    n1 = body[i]; i += 1
                    if hi in (0x80, 0x90, 0xA0):
                        n2 = body[i]; i += 1
                    else:
                        n2 = body[i] if hi == 0xB0 else 0; i += 1
                    if hi == 0x90 and n2 > 0:
                        on.setdefault(n1, []).append(tk)
                    elif hi == 0x80 or (hi == 0x90 and n2 == 0):
                        if on.get(n1):
                            s = on[n1].pop(0)
                            out.append((s / float(div), (tk - s) / float(div),
                                        NM[n1 % 12] + str(n1 // 12 - 1)))
                else:
                    i += 1
        return sorted(out)


if __name__ == '__main__':
    up = run('up'); dn = run('down')
    print('parsed  RH: %d tokens, total %.2f 16ths (=%.2f bars)'
          % (len(up.out), up.t, (up.t - 2) / 6.0))
    print('parsed  LH: %d tokens, total %.2f 16ths (=%.2f bars)'
          % (len(dn.out), dn.t, (dn.t - 2) / 6.0))
    mid = glob.glob('*.mid')[0]
    for label, p, tr in (('RIGHT HAND', up, 1), ('LEFT HAND', dn, 2)):
        mn = midi_notes(mid, tr)
        same = 0; diffs = []
        for i in range(min(len(mn), len(p.out))):
            mpos, mdur, mp = mn[i]
            lpos, ldur, lt = p.out[i]
            if abs(mpos - lpos) < 0.03 and abs(mdur - ldur) < 0.03:
                same += 1
            else:
                diffs.append((i, (round(mpos, 2), round(mdur, 2), mp),
                              (round(lpos, 2), ldur, lt)))
        print('\n%s vs MIDI: matched %d / %d   (midi=%d notes, ly=%d tokens)'
              % (label, same, min(len(mn), len(p.out)), len(mn), len(p.out)))
        for x in diffs[:8]:
            print('    idx %-4d MIDI=%-24s LY=%s' % x)
