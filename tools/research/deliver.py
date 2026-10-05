# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
import final2 as F
UP=F.run('up'); DN=F.run('down')
def render(BS,tag,lo,hi):
    print('\n'+'='*78);print('%s  --  mm.%d-%d   (3/8 bar = 6 sixteenths)'%(tag,lo,hi));print('='*78)
    for n,ev,clef,alt,st in BS:
        if not (lo<=n<=hi): continue
        v='a' if alt else ' '
        if not ev:
            print('m.%-3d%s  FULL-MEASURE REST (multi-bar rest)'%(n,v)); continue
        parts=[]
        for o,t,d,rest in ev:
            if rest: parts.append('r[%s]@%d'%(F.dw(d),o)); continue
            if t.startswith('<'):
                ps=[F.midi_of(x) for x in t.strip('<> ').split()]; ps=[p for p in ps if p is not None]
                parts.append('<%s>[%s]@%d'%(','.join(F.nm(p) for p in ps),F.dw(d),o))
            else:
                parts.append('%s[%s]@%d'%(F.nm(F.midi_of(t)),F.dw(d),o))
        tot=sum(x[2] for x in ev)
        flag='' if abs(tot-6)<1e-9 else '   (bar holds %g/6)'%tot
        cl='  [clef %s]'%clef if clef else ''
        print('m.%-3d%s %s%s'%(n,v,'  '.join(parts),flag+cl))
render(UP,'RIGHT HAND (treble)',9,26)
render(DN,'LEFT HAND (bass)',9,26)
