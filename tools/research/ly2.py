# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
import re
src=open('fur_Elise_WoO59.ly',encoding='utf-8').read()

def body(name):
    i=src.find('\\new Staff = "%s"'%name)
    j=src.find('\\new Staff = "',i+10)
    k=src.find('\\new Dynamics',i)
    return src[i:min(x for x in (j,k,len(src)) if x>i)]

TOK=re.compile(r"""
  \\partial\s+(?P<partial>\d+\.*)
| \\repeat\s+volta\s+(?P<volta>\d+)
| (?P<alternative>\\alternative)
| \\bar\s+"(?P<bar>[^"]*)"
| \\clef\s+(?P<clef>treble|bass)
| \\[a-zA-Z]+
| <[^>]*>
| (?P<note>[a-g](?:is|es|eses|s|f|ff|x)*[',]*)(?P<dur>\d*\.*)
| (?P<rest>[rR])(?P<rdur>\d*\.*)
| (?P<skip>\S)
""",re.X)

def pdur(t):
    if not t: return None
    m=re.fullmatch(r'(\d+)(\.*)',t)
    if not m: return None
    n=int(m.group(1)); dots=len(m.group(2))
    if n not in (1,2,4,8,16,32,64): return None
    b={1:64,2:32,4:16,8:8,16:4,32:2,64:1}[n]
    return int(b*(2-2**(-dots))) if dots else b

def run(name):
    b=body(name)
    cur=None; bars=[]; bar=[]; total=0; inpick=True; rmbars=0
    meas=0
    print('\n'+'='*72);print('STAFF',name);print('='*72)
    for m in TOK.finditer(b):
        if m.group('partial') is not None:
            inpick=True; print('  \\partial %s  (pickup = %d sixteenths)'%(m.group('partial'),pdur(m.group('partial')))); continue
        if m.group('volta'): print('  --- \\repeat volta %s ---'%m.group('volta')); continue
        if m.group('alternative'): print('  --- \\alternative (endings follow) ---'); continue
        if m.group('clef'): print('  [clef %s]'%m.group('clef')); continue
        if m.group('bar') is not None: print('  [\\bar "%s"] @bar%d'%(m.group('bar'),meas)); continue
        note=m.group('note')
        if note:
            d=pdur(m.group('dur'))
            if d: cur=d
            elif cur is None: cur=4
            meas+=1
            bar.append((total,note,d)); total+=d
            lim=2 if inpick else 6
            if total>=lim:
                print('  m.%-3d %s'%(meas-1,' '.join('%s@%d/%d'%(n,o,d) for o,n,d in bar)))
                bar=[]; total=0; inpick=False
            continue
        r=m.group('rest')
        if r:
            if r=='R':
                lim=2 if inpick else 6
                meas+=1
                print('  m.%-3d R[full-measure rest]'%(meas-1)); bar=[];total=0;inpick=False
                continue
            d=pdur(m.group('rdur'))
            if d: cur=d
            elif cur is None: cur=4
            meas+=1
            bar.append((total,'rest',d)); total+=d
            lim=2 if inpick else 6
            if total>=lim:
                print('  m.%-3d %s'%(meas-1,' '.join('%s@%d/%d'%(n,o,d) for o,n,d in bar)))
                bar=[];total=0;inpick=False
            continue
    if bar: print('  m.%-3d (partial) %s'%(meas,' '.join('%s@%d/%d'%(n,o,d) for o,n,d in bar)))

run('up')
