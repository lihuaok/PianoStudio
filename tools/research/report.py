# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
import m9, lyx, glob, re
NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
UP=m9.run('up'); DN=m9.run('down')
MID=glob.glob('*.mid')[0]
BASE={'C':0,'C#':1,'D':2,'D#':3,'E':4,'F':5,'F#':6,'G':7,'G#':8,'A':9,'A#':10,'B':11}
def mnum(n):
    q=re.match(r"^([A-G]#?)(-?\d+)$",n); return BASE[q.group(1)]+12*(int(q.group(2))+1)
def nm(midi):
    return NAMES[midi%12]+str(midi//12-1)
def bars(tr):
    mn=lyx.midi_notes(MID,tr); d={}
    for p,dd,n in mn:
        s=p*4; b=int((s-2)//6)+1; off=(s-2)%6
        d.setdefault(b,[]).append((int(off),int(round(dd*4)),mnum(n)))
    return {k:sorted(v) for k,v in d.items()}
MRH=bars(1); MLH=bars(2)
def show(tag,model,mb,lo,hi):
    print('\n'+'#'*72);print('### %s  mm.%d-%d'%(tag,lo,hi));print('#'*72)
    for m,kind,ev,clef in model:
        if kind=='mm-rest':
            if lo<=m<=hi: print('m.%-3d  %s'%(m,'FULL-MEASURE REST (multi-bar rest)'))
            continue
        if not (lo<=m<=hi): continue
        s=[]
        for off,txt,d,rest in ev:
            if rest:
                s.append('rest[%s]@%d'%(m9.durword(d),off)); continue
            if txt.startswith('<'):
                ps=[m9.midi_of(x) for x in txt.strip('<> ').split()]
                ps=[p for p in ps if p is not None]
                s.append('chord{%s}[%s]@%d'%(','.join(nm(p) for p in ps),m9.durword(d),off))
            else:
                s.append('%s[%s]@%d'%(nm(m9.midi_of(txt)),m9.durword(d),off))
        v=[]
        if m in mb:
            for off,d,p in mb[m]: v.append('%s[%s]@%d'%(nm(p),m9.durword(d),off))
        agree='MIDI-OK' if v and ' '.join(v).replace(' ','')==' '.join(s).replace(' ','') else ('midi:%d notes'%len(mb.get(m,[])))
        print('m.%-3d %-6s %s'%(m,('cl='+clef) if clef else '',agree))
        for x in s: print('        '+x)
show('RIGHT HAND',UP,MRH,9,26)
show('LEFT HAND',DN,MLH,9,26)
