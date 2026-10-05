# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
"""Duration-accurate scanner for the Mutopia LilyPond source.
Measures every 16th; reports bar-by-bar content for each staff."""
import re,sys
src=open('fur_Elise_WoO59.ly',encoding='utf-8').read()

def staff_body(name):
    i=src.find('\\new Staff = "%s"'%name)
    j=src.find('\\new Staff = "',i+10)
    k=src.find('\\new Dynamics',i)
    end=min(x for x in (j,k,len(src)) if x>i)
    return src[i:end]

TOK=re.compile(r"""
   \\partial\s+(?P<partial>\d+) |
   \\repeat\s+volta\s+(?P<volta>\d+) |
   \\alternative |
   \\bar\s+"(?P<bar>[^"]*)" |
   \\clef\s+(?P<clef>\w+) |
   \\set\s+Timing\.[^ ]*\s*=\s*\(#\(ly:make-moment\s*(?P<mm>[-+*/\d ]+)\) |
   \\[a-zA-Z]+ |
   <(?P<ch>[^>]*)> |
   (?P<note>[a-g](?:is|es|s|f|ff|x)?[',]*)(?P<dur>\d+\.*) |
   (?P<rest>[rR])(?P<rdur>\d+\.*) |
   (?P<other>\S+)
""",re.X)

PITCHSTEP={'c':0,'d':2,'e':4,'f':5,'g':7,'a':9,'b':11}
def parsedur(txt):
    """'16'->4 (in 16ths), '4.'->12, '8.'->6. Returns None if not a duration."""
    txt=txt.strip()
    if not txt: return None
    m=re.fullmatch(r'(\d+)(\.*)',txt)
    if not m: return None
    n=int(m.group(1)); dots=len(m.group(2))
    if n<=0: return None
    base={1:64,2:32,4:16,8:8,16:4,32:2,64:1}[n]
    return base*(2-2**(-dots)) if dots else base

def scan(body,label):
    print('='*70);print(label);print('='*70)
    pos=0;cur=None;bar_dur=0;bar=0;partial=None
    events=[]   # (baridx, offset16, text)
    pending=''
    for m in TOK.finditer(body):
        if m.group('partial'):
            partial=parsedur(m.group('partial'));bar_dur=partial
            print('  [pickup: \\partial %s  -> %d sixteenths]'%(m.group('partial'),partial))
            continue
        if m.group('volta'):
            print('  --- \\repeat volta %s ---'%m.group('volta'));continue
        if m.group('alternative'):
            print('  --- \\alternative ---');continue
        if m.group('clef'): print('  [clef %s]'%m.group('clef'));continue
        if m.group('mm') is not None: print('  [measurePosition hack: %s]'%m.group('mm'));continue
        if m.group('bar') is not None: print('  [\\bar "%s"]'%m.group('bar'));continue
        dur=parsedur(m.group('dur') or '') if m.group('note') else None
        if m.group('note'):
            d=dur or cur
            if d is None: d=4;cur=4
            else: cur=d if dur else cur
            tokname=m.group('note')
            if bar_dur>= (partial if bar==0 else 6):
                bar+=1;bar_dur=0
            events.append((bar,bar_dur,tokname+'['+str(d)+']'))
            bar_dur+=d
        elif m.group('rest'):
            d=(parsedur(m.group('rdur')) if m.group('rdur') else None) or cur or 4
            if m.group('rest')=='R':
                d=6;bar_dur=(6 if bar_dur==0 else bar_dur+6)
                events.append((bar,bar_dur-6,'R[mm-rest]'));continue
            if bar_dur>=(partial if bar==0 else 6):
                bar+=1;bar_dur=0
            events.append((bar,bar_dur,'r['+str(d)+']'));bar_dur+=d
        elif m.group('ch'):
            print('  [chord %s]'%m.group('ch'));continue
    return events

for nm in ('up','down'):
    ev=scan(staff_body(nm),'STAFF '+nm)
    if nm=='up':
        import collections
        g=collections.OrderedDict()
        for b,o,t in ev: g.setdefault(b,[]).append((o,t))
        print('\n--- %s: bar-by-bar (bar0=pickup) ---'%nm)
        for b in sorted(g):
            if 8<=b<=30:
                print('  bar%-3d off=%-42s sum=%d'%(b,' '.join(t for o,t in g[b]),sum(1 for _ in ())*0 or ''))
