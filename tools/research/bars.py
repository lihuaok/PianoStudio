# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

import struct,glob
d=open(glob.glob('*.mid')[0],'rb').read()
pos=8+struct.unpack('>I',d[4:8])[0]
def vlq(b,i):
    v=0
    while True:
        c=b[i];i+=1;v=(v<<7)|(c&0x7f)
        if not c&0x80:return v,i
tr={};t=0
while pos<len(d):
    ln=struct.unpack('>I',d[pos+4:pos+8])[0];body=d[pos+8:pos+8+ln];pos+=8+ln
    i=0;tk=0;run=None;ev=[]
    while i<len(body):
        dt,i=vlq(body,i);tk+=dt;st=body[i]
        if st<0x80:st=run
        else:i+=1;run=st
        if st==0xFF:
            mt=body[i];i+=1;l,i=vlq(body,i);i+=l
        elif st in(0xF0,0xF7):
            l,i=vlq(body,i);i+=l
        else:
            hi=st&0xF0
            if hi in(0x80,0x90,0xA0,0xB0,0xE0):
                n1=body[i];i+=1
                if hi in(0x80,0x90,0xA0):n2=body[i];i+=1
                else:
                    n2=body[i] if hi==0xB0 else 0;i+=1
                if hi==0x90 and n2>0:ev.append((tk,'O',n1))
                elif hi==0x80 or(hi==0x90 and n2==0):ev.append((tk,'X',n1))
            else:i+=1
    tr[t]=ev;t+=1
NAMES=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
def nm(p):return NAMES[p%12]+str(p//12-1)
def notes(t):
    on={};out=[]
    for tk,k,p in sorted(tr[t]):
        if k=='O':on.setdefault(p,[]).append(tk)
        elif k=='X' and on.get(p):out.append((on[p].pop(0),tk,p))
    return sorted(out)
RH=notes(1);LH=notes(2)
PICK=192;BAR=576
def bar(s): return (s-PICK)//BAR+1
def off(s): return (s-PICK)%BAR
DUR={96:'16th',192:'8th',288:'dotted-8th',384:'quarter',48:'32nd',144:'dotted-16th'}
def show(ns,lo,hi,label):
    print('\n===== %s ====='%label)
    for m in range(lo,hi+1):
        items=[(s,o,p) for s,o,p in ns if PICK+(m-1)*BAR<=s<PICK+m*BAR]
        if not items: 
            print('m%-3d  (empty / multi-measure rest)'%m); continue
        toks=[];prev=None
        for s,o,p in items:
            st=off(s)
            gap='' if (prev is None or st==prev) else 'REST%d '%((st-prev)//96)
            toks.append('%s%s@%d[%s]'%(gap,nm(p),st,DUR.get(o-s,'%dt'%(o-s))))
            prev=st+(o-s)
        slack=BAR-prev
        tail='  +slack=%d'%slack if slack else ''
        print('m%-3d  %s%s'%(m,' '.join(toks),tail))
show(RH,1,30,'RIGHT HAND mm.1-30')
show(LH,1,30,'LEFT HAND mm.1-30')
