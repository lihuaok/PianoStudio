# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
"""Duration-exact parser for Mutopia fur_Elise_WoO59.ly.
Units: 1 = one 16th note. A 3/8 bar = 6 units. \\partial 8 = 2 units."""
import re
src=open('fur_Elise_WoO59.ly',encoding='utf-8').read()
def body(name):
    i=src.find('\\new Staff = "%s"'%name); j=src.find('\\new Staff = "',i+10)
    k=src.find('\\new Dynamics',i)
    return src[i:min(x for x in (j,k,len(src)) if x>i)]
TOK=re.compile(r"""
  \\partial\s+(?P<partial>\d+\.*)
| \\repeat\s+volta\s+(?P<volta>\d+)
| (?P<alternative>\\alternative)
| \\bar\s+"(?P<bar>[^"]*)"
| \\clef\s+(?P<clef>treble|bass)
| \\set\s+Timing\.measurePosition
| \\tuplet\s+(?P<tup>\d+/\d+)
| \\grace\s*\{|\\appoggiatura
| \\[a-zA-Z]+
| (?P<chord><[^>]*>)
| (?P<note>[a-g](?:is|es|eses|eses|ff|f|s|x)*[',]*)(?P<dur>\d+\.*)?
| (?P<rest>[rR])(?P<rdur>\d+\.*)?
| (?P<skip>\S)
""",re.X)
def pdur(t):
    if not t: return None
    m=re.fullmatch(r'(\d+)(\.*)',t)
    if not m: return None
    n=int(m.group(1)); dots=len(m.group(2))
    b={1:16,2:8,4:4,8:2,16:1,32:0.5,64:0.25}.get(n)
    if b is None: return None
    return b*(2-2**(-dots)) if dots else b
def parse(name):
    b=body(name); cur=4.0; total=0.0; idx=-1; pickup=None
    bar=[]; out=[]; rep=0; alt=0; intup=False
    for m in TOK.finditer(b):
        g=m.groupdict()
        if g['partial'] is not None: pickup=pdur(g['partial']); continue
        if g['volta'] is not None: rep+=1; print('  === \\repeat volta %s  (block #%d) ==='%(g['volta'],rep)); continue
        if g['alternative'] is not None: alt=1; print('  === \\alternative ==='); continue
        if g['clef'] is not None: print('  [clef %s @bar idx %d]'%(g['clef'],idx)); continue
        if g['bar'] is not None: print('  [\\bar "%s"] before bar idx %d'%(g['bar'],idx+1)); continue
        if g['tup'] is not None: print('  [\\tuplet %s @bar %d]'%(g['tup'],idx+1)); continue
        if m.group(0) in ('\\grace {','\\appoggiatura'): print('  [%s @bar %d]'%(m.group(0).strip(),idx+1)); continue
        note=g['note']
        if note:
            d=pdur(g['dur'])
            if d: cur=d
            bar.append((total,note,cur)); total+=cur; continue
        r=g['rest']
        if r:
            if r=='R':
                d=pdur(g['rdur']) or 6
                out.append((idx,'R full-measure rest',None)); idx+=1; bar=[];total=0.0
                print('  bar %-3d  R (multi-measure rest)'%idx); continue
            d=pdur(g['rdur'])
            if d: cur=d
            bar.append((total,'rest',cur)); total+=cur; continue
        if m.group(0)=='}':
            if bar:
                out.append((idx,bar,pickup)); 
                print('  bar %-3d  %s'%(idx,' '.join('%s@%g/%g'%(t,o,dd) for o,t,dd in bar)))
                bar=[];total=0.0; idx+=1
            pickup=None
            continue
    return out
print('###STAFF UP###'); parse('up')
