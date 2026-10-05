# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
"""Bar-exact extraction from Mutopia fur_Elise_WoO59.ly.
3/8 bar = 6 sixteenths. LilyPond closes a bar when accumulated duration
reaches 6, ALLOWING the final note to overshoot (that is how the engraving
renders). Measure numbers therefore match the printed score.
"""
import re, glob
SRC=open('fur_Elise_WoO59.ly',encoding='utf-8').read()
DU={1:16,2:8,4:4,8:2,16:1,32:0.5,64:0.25}
STEP={'c':0,'d':2,'e':4,'f':5,'g':7,'a':9,'b':11}
NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
def dur(t):
    if not t: return None
    m=re.fullmatch(r'(\d+)(\.*)',t)
    if not m: return None
    b=DU.get(int(m.group(1)))
    if b is None: return None
    k=len(m.group(2))
    return float(b)*(2-2**(-k)) if k else float(b)
def dw(v):
    for k,n in ((1,'whole'),(2,'half'),(4,'quarter'),(8,'eighth'),(16,'16th'),(32,'32nd'),(64,'64th')):
        b=16.0/k
        if abs(v-b)<1e-6: return n
        if abs(v-b*1.5)<1e-6: return 'dot-'+n
    return '%g/16'%v
def midi_of(t):
    m=re.match(r"^([a-g])((?:ises|eses|iss|es|is|s|x)*)([',]*)",t)
    if not m: return None
    v=STEP[m.group(1)]; ac=m.group(2) or ''
    if ac=='is': v+=1
    elif ac in ('es','eses'): v-=1
    return 60+(m.group(3).count("'")-m.group(3).count(',')-1)*12+v
def nm(x): return NAMES[x%12]+str(x//12-1)
def staff_src(n):
    i=SRC.find('\\new Staff = "%s"'%n); j=SRC.find('\\new Staff = "',i+10)
    k=SRC.find('\\new Dynamics',i)
    return SRC[i:min(x for x in (j,k,len(SRC)) if x>i)]
NOTE=r"[a-g](?:ises|eses|iss|es|is|s|x)*[',]*\d*\.*"
TOK=re.compile(r"""
    \\partial\s+(?P<pd>\d+\.*)
  | \\repeat\s+volta\s+\d+
  | \\alternative
  | \\bar\s+"[^"]*"
  | \\set\s+Timing\.[^\n]*
  | \\set\s+Timing\.[^\n]*
  | \\override[^\n]*
  | \\key\s+[a-g]\s*\\[a-z]+
  | \\time\s+\d+/\d+
  | \\clef\s+(?P<clef>[a-z]+)
  | \\tempo\s+[^=]*=
  | \\tuplet\s+(?P<tn>\d+)\s*/\s*(?P<td>\d+)
  | (?P<grace>\\grace\b|\\appoggiatura\b)
  | \\markup\s*\{(?:[^{}]|\{[^{}]*\})*\}
  | \\[a-zA-Z]+ | "(?:[^"\\]|\\.)*"
  | (?P<chord><[^>]*>)
  | (?P<note>%s)
  | (?P<rest>[rR])(?P<rdur>\d+\.*)?
  | (?P<num>\d+\.*) | [A-Za-z]{2,} | \S
"""%NOTE,re.X)

def run(name):
    bars=[]; cur=[]; ln=0.0; num=0; start=0.0; pos=0.0
    pick=None; inpick=True; d=4.0; st=[]; dep=0; ch=None; clef=None
    alt=False
    altdepth=0
    endbars=0
    in_end2=[False]
    depth=0
    def cap(): return pick if inpick else 6.0
    def close(force=False):
        nonlocal cur,ln,num,start,pos,inpick,alt,clef,endbars
        nonlocal in_end2
        c=cap()
        if not force and ln<c-1e-9: return
        if endbars and ln<c-1e-9:
            pass                      # an \alternative ending may be short
        elif ln<c-1e-9:
            cur.append((round(ln,6),'rest',c-ln,True)); ln=c
        v=0
        v=0
        if endbars==2:
            v=1
        elif endbars==1:
            v=2
        was = endbars
        if endbars:
            endbars-=1
        # after ending 1 is emitted we are inside ending 2: suppress bar closes
        in_end2[0] = (was == 2)
        bars.append((num,cur,clef,v,start))
        if inpick:
            inpick=False; num=1
        elif not alt:
            num+=1
        # if alt: this measure is an ending -> it shares the measure number
        alt=False; cur=[]; ln=0.0; start=pos; clef=None
    for mt in TOK.finditer(staff_src(name)):
        t=mt.group(0); g=mt.groupdict()
        if g['pd'] is not None: pick=dur(g['pd']); continue
        # \bar "" (invisible) and \bar "|." etc. never change musical
        # bar grouping here, so all \bar tokens are ignored.
        if t=='\\alternative':
            alt=True; altdepth=depth; endbars=2; continue
        if g['tn'] is not None:
            st.append(('tup',int(g['td'])/float(g['tn']))); dep+=1; continue
        if g['grace'] is not None:
            st.append(('skip',1.0)); dep+=1; continue
        if t=='{':
            depth+=1
            continue
        if t=='}':
            if altdepth and depth==altdepth+2:
                depth-=1
                close(force=True)   # an \alternative ending is its own bar
                continue
            if altdepth and depth==altdepth+1:
                depth-=1
                altdepth=0
                endbars=0
                continue
            depth-=1
            if st and dep>0:
                dep-=1
                if dep==0: st.pop()
            continue
        if t.startswith('\\'): continue
        if any(k=='skip' for k,_ in st): continue
        sc=1.0
        for k,v in st:
            if k=='tup': sc*=v
        if g['clef'] is not None: clef=g['clef']; continue
        def emit(txt,dd,rest=False):
            nonlocal ln,pos
            cur.append((round(ln,6),txt,dd,rest)); ln+=dd; pos+=dd
        def bnd():
            if in_end2[0]: return          # inside ending 2: never close
            if ln>=cap()-1e-9: close()
        # (ending 2 is closed exactly once, at its closing brace)
        if g['chord'] is not None: ch=g['chord']; continue
        if g['num'] is not None and ch is not None:
            d0=dur(g['num'])
            if d0: d=d0
            bnd(); emit(ch,d*sc); ch=None; continue
        if g['note'] is not None:
            ch=None; note=g['note']
            tl=re.search(r"[',]*(\d*\.*)$",note); d0=dur(tl.group(1)) if tl and tl.group(1) else None
            if d0: d=d0
            bnd(); emit(note,d*sc); continue
        if g['rest'] is not None:
            ch=None
            if g['rest']=='R':
                q=dur(g['rdur']) or 4.0
                nb=max(1,int(round((q/4.0)/1.5)))
                if ln>1e-9: close(force=True)
                for _ in range(nb):
                    num+=1; bars.append((num,[],clef,False,pos)); pos+=6.0; start=pos
                continue
            d0=dur(g['rdur'])
            if d0: d=d0
            bnd(); emit('rest',d*sc,True); continue
    if cur: close(force=True)
    return bars

if __name__=='__main__':
    UP=run('up'); DN=run('down')
    for tag,BS in (('RIGHT HAND',UP),('LEFT HAND',DN)):
        print('\n'+'='*74);print(tag,' mm.9-26  (offsets in 16ths; 3/8 bar = 6)');print('='*74)
        for n,ev,clef,alt,st in BS:
            if not (9<=n<=26): continue
            if not ev:
                print('m.%-3d%s  (multi-measure rest)'%(n,'a' if alt else ' ')); continue
            s=[]
            for off,txt,dd,rest in ev:
                if rest: s.append('rest[%-9s]@%d'%(dw(dd),off)); continue
                if txt.startswith('<'):
                    ps=[midi_of(x) for x in txt.strip('<> ').split()]; ps=[p for p in ps if p is not None]
                    s.append('CHORD{%s}[%-9s]@%d'%(','.join(nm(p) for p in ps),dw(dd),off))
                else:
                    s.append('%-5s[%-9s]@%d'%(nm(midi_of(txt)),dw(dd),off))
            tot=sum(x[2] for x in ev)
            flag='' if abs(tot-6)<1e-9 else '  <== %g/6'%tot
            lab={0:' ',1:'a',2:'b'}.get(alt,'?')
            print('m.%-3d%s %s%s'%(n,lab,'  '.join(s),flag))
