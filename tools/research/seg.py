# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

import struct,glob
d=open(glob.glob('*.mid')[0],'rb').read()
div=struct.unpack('>H',d[12:14])[0]
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
            mt=body[i];i+=1;l,i=vlq(body,i);dat=body[i:i+l];i+=l
            if mt in(0x01,0x05,0x06):ev.append((tk,'T',dat.decode('latin1')))
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
    ev=sorted(tr[t]);on={};out=[]
    for tk,k,p in ev:
        if k=='O':on.setdefault(p,[]).append(tk)
        elif k=='X':
            if on.get(p):
                s=on[p].pop(0);out.append((s,tk,p))
    return sorted(out)
RH=notes(1);LH=notes(2)
TOT=max(o for _,o,_ in RH+LH)
PICK=192;BAR=576
print('total ticks',TOT,'pickup',PICK,'bar',BAR,'-> bars after pickup',(TOT-PICK)/BAR)
def dump(ns,lo,hi,label):
    print('#### '+label)
    for s,o,p in ns:
        if not(PICK+ (lo-1)*BAR <= s < PICK+hi*BAR):continue
        num=(s-PICK)//BAR;off=(s-PICK)%BAR
        onb = 'PICKUP' if s<PICK else 'm%d+%d'%(num,off)
        print('  %-10s %-5s dur=%-5d (%d/48)'%(onb,nm(p),o-s,(o-s)/48))
dump(RH,1,27,'RIGHT HAND mm.1-27')
