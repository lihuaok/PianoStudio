# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

import struct,glob
fn=glob.glob('*.mid')[0]
d=open(fn,'rb').read()
assert d[:4]==b'MThd'
hlen=struct.unpack('>I',d[4:8])[0]; fmt,ntrk,div=struct.unpack('>HHH',d[8:14])
print('format',fmt,'ntracks',ntrk,'division(ticks/quarter)',div)
pos=8+hlen
def vlq(b,i):
    v=0
    while True:
        c=b[i]; i+=1; v=(v<<7)|(c&0x7f)
        if not c&0x80: return v,i
tempo=None;tsig=None;key=None
events=[]
for t in range(ntrk):
    assert d[pos:pos+4]==b'MTrk',(t,pos)
    ln=struct.unpack('>I',d[pos+4:pos+8])[0]; body=d[pos+8:pos+8+ln]; pos+=8+ln
    i=0;ticks=0;run=None
    while i<len(body):
        dt,i=vlq(body,i);ticks+=dt
        st=body[i]
        if st<0x80: st=run
        else: i+=1;run=st
        if st==0xFF:
            mt=body[i];i+=1;l,i=vlq(body,i);dat=body[i:i+l];i+=l
            if mt==0x51: tempo=struct.unpack('>I',b'\0'+dat)[0]
            elif mt==0x58: tsig=(dat[0],2**dat[1])
            elif mt==0x59: key=(dat[0]&0xff,dat[1]&0xff)
            elif mt in (0x01,0x05): events.append((ticks,0,'TEXT',dat.decode('latin1')))
            elif mt==0x06: events.append((ticks,0,'MARKER',dat.decode('latin1')))
        elif st in (0xF0,0xF7):
            l,i=vlq(body,i);i+=l
        else:
            hi=st&0xF0
            if hi in (0x80,0x90,0xA0,0xB0,0xE0):
                n1=body[i];i+=1
                if hi in (0x80,0x90): n2=body[i];i+=1
                else: n2=body[i] if hi==0xB0 else 0;i+=1
                if hi==0x90 and n2>0: events.append((ticks,n1,'ON',t))
                elif hi==0x80 or (hi==0x90 and n2==0): events.append((ticks,n1,'OFF',t))
                if hi==0xB0 and n1==0x58 and n2: tsig=(n1,2**n2)
            else: i+=1
print('tempo us/qn',tempo,'-> bpm',round(60000000/tempo,2),'timesig',tsig,'key',key)
ons={};offs={}
for tk,p,kind,tr in events:
    (ons if kind=='ON' else offs).setdefault((tr,p),[]).append(tk)
names=['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
for tr in range(ntrk):
    ns=[]
    for (t2,p),st in ons.items():
        if t2!=tr: continue
        for k,s in enumerate(st):
            o=offs.get((t2,p),[])[k]
            ns.append((s,o,p))
    if not ns: continue
    ns.sort()
    print('=== track',tr,'notes',len(ns),'first',ns[0],'last',ns[-1])
    globals()['tr%d'%tr]=ns
