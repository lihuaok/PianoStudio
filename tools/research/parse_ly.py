# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
"""Bar-exact parser for Mutopia fur_Elise_WoO59.ly (independent engraving,
source Breitkopf & Haertel 1888).  Units: 1 = one 16th note; 3/8 bar = 6."""
import re

SRC = open('fur_Elise_WoO59.ly', encoding='utf-8').read()
DU = {1: 16, 2: 8, 4: 4, 8: 2, 16: 1, 32: 0.5, 64: 0.25}
EPS = 1e-9


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
    return b * (2 - 2 ** (-d)) if d else float(b)


def staff_src(name):
    i = SRC.find('\\new Staff = "%s"' % name)
    j = SRC.find('\\new Staff = "', i + 10)
    k = SRC.find('\\new Dynamics', i)
    return SRC[i:min(x for x in (j, k, len(SRC)) if x > i)]


TOK = re.compile(r"""
    \\partial\s+(?P<partial>\d+\.*)
  | \\repeat\s+volta\s+(?P<volta>\d+)
  | (?P<alt>\\alternative)
  | \\bar\s+"(?P<bar>[^"]*)"
  | \\tuplet\s+(?P<tn>\d+)\s*/\s*(?P<td>\d+)
  | (?P<grace>\\grace\b|\\appoggiatura\b)
  | \\[a-zA-Z]+
  | (?P<chord><[^>]*>)
  | (?P<note>[a-g](?:is|es|eses|s|x)?[',]*)(?P<ndur>\d+\.*)?
  | (?P<rest>[rR])(?P<rdur>\d+\.*)?
  | (?P<num>\d+\.*)
  | (?P<other>\S)
""", re.X)


class St(object):
    def __init__(self):
        self.mode = []
        self.depth = 0
        self.cur = 4.0
        self.total = 0.0
        self.bar = []
        self.label = None
        self.n = 0
        self.alt = 0
        self.pickup = True
        self.events = []
        self.chord = None
        self.scale = 1.0

    def newbar(self):
        if self.pickup:
            self.label = 0
            self.pickup = False
        elif self.alt == 1:
            self.n += 1
            self.label = self.n
            self.alt = 2
        elif self.alt == 2:
            self.label = self.n
            self.alt = 0
        else:
            self.n += 1
            self.label = self.n
        self.bar = []
        self.total = 0.0

    def add(self, text, d):
        self.bar.append((self.total, text, d))
        self.total += d
        if self.total >= 6 - EPS:
            self.events.append((self.label, self.bar))
            self.newbar()


def parse(name):
    s = St()
    for m in TOK.finditer(staff_src(name)):
        t = m.group(0)
        g = m.groupdict()
        if g['partial'] is not None:
            continue
        if g['alt'] is not None:
            s.alt = 1
            continue
        if g['volta'] is not None or g['bar'] is not None:
            continue
        if g['tn'] is not None:
            s.mode.append(('tup', int(g['td']) / float(g['tn'])))
            s.depth += 1
            s.scale = s.mode[-1][1]
            continue
        if g['grace'] is not None:
            s.mode.append(('skip', 1.0))
            s.depth += 1
            continue
        if t == '{':
            continue
        if t == '}':
            if s.mode and s.depth > 0:
                s.depth -= 1
                if s.depth == 0:
                    s.mode.pop()
                    s.scale = s.mode[-1][1] if s.mode else 1.0
            continue
        if t.startswith('\\'):
            continue

        if any(k == 'skip' for k, _ in s.mode):
            continue
        sc = 1.0
        for k, v in s.mode:
            if k == 'tup':
                sc *= v

        if g['chord'] is not None:
            s.chord = g['chord']
            continue
        if g['num'] is not None and s.chord:
            d = (dur(g['num']) or s.cur) * sc
            s.cur = d
            s.chord = None
            if s.total + d > 6 + EPS and s.total > 0:
                s.newbar()
            s.add(s.bar and '' or '', d) if False else None
            s.bar.append((s.total, s.chord or '', d))
            s.total += d
            if s.total >= 6 - EPS:
                s.events.append((s.label, s.bar))
                s.newbar()
            continue
        if g['note'] is not None:
            s.chord = None
            d0 = dur(g['ndur'])
            if d0:
                s.cur = d0
            d = s.cur * sc
            if s.total + d > 6 + EPS and s.total > 0:
                s.newbar()
            s.add(g['note'], d)
            continue
        if g['rest'] is not None:
            s.chord = None
            if g['rest'] == 'R':
                if s.total > 0:
                    s.events.append((s.label, s.bar))
                    s.newbar()
                s.newbar()
                s.bar.append((0.0, 'R(mm-rest)', 6.0))
                s.events.append((s.label, s.bar))
                s.newbar()
                continue
            d0 = dur(g['rdur'])
            if d0:
                s.cur = d0
            d = s.cur * sc
            if s.total + d > 6 + EPS and s.total > 0:
                s.newbar()
            s.add('r', d)
            continue
    if s.bar:
        s.events.append((s.label, s.bar))
    return s.events


def show(events, lo, hi, title):
    print('\n' + '=' * 76)
    print(title)
    print('=' * 76)
    for lbl, ev in events:
        if lbl is None or not (lo <= lbl <= hi):
            continue
        tot = sum(d for _, _, d in ev)
        toks = ' '.join('%s@%g/%g' % (t, o, d) for o, t, d in ev)
        flag = '' if (abs(tot - 6) < EPS or lbl == 0) else '   <<<SUM=%g' % tot
        print('m.%-4s %s%s' % (lbl, toks, flag))


if __name__ == '__main__':
    up = parse('up')
    dn = parse('down')
    print('last printed bar  RH=%s  LH=%s' % (up[-1][0], dn[-1][0]))
    show(up, 0, 10, 'RIGHT HANDS mm.0-10')
    show(up, 9, 26, 'RIGHT HAND mm.9-26')
    show(dn, 9, 26, 'LEFT HAND mm.9-26')
