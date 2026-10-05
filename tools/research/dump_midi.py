# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
"""Dump EVERY note event of the Mutopia MIDI to a text file.

Format per line:
    tick=<t> dur=<d> track=<0|1> note=<E5> midi=<76> velocity=<v>

track 0 = upper staff (treble / right hand)  -> MIDI track 1
track 1 = lower staff (bass  / left  hand)  -> MIDI track 2
Ticks are absolute MIDI ticks (division = ticks per quarter, printed in header).
"""
import struct, os

MID = 'fur_Elise_WoO59.mid'
OUT = 'tools/scoredata/fur_elise_midi_dump.txt'
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']


def nm(m):
    return NAMES[m % 12] + str(m // 12 - 1)


def vlq(b, i):
    v = 0
    while True:
        c = b[i]; i += 1
        v = (v << 7) | (c & 0x7F)
        if not c & 0x80:
            return v, i


def main():
    d = open(MID, 'rb').read()
    assert d[:4] == b'MThd', 'not a MIDI file'
    hlen = struct.unpack('>I', d[4:8])[0]
    fmt, ntrk, div = struct.unpack('>HHH', d[8:14])

    pos = 8 + hlen
    rows = []
    t = 0
    while pos < len(d):
        assert d[pos:pos + 4] == b'MTrk', 'bad track chunk at %d' % pos
        ln = struct.unpack('>I', d[pos + 4:pos + 8])[0]
        body = d[pos + 8:pos + 8 + ln]
        pos += 8 + ln

        i = 0; tk = 0; run = None
        # stack of (start_tick, velocity) per pitch
        pend = {}
        while i < len(body):
            dt, i = vlq(body, i); tk += dt
            st = body[i]
            if st < 0x80:
                st = run
            else:
                i += 1; run = st
            if st == 0xFF:
                mt = body[i]; i += 1
                l, i = vlq(body, i)
                i += l
                continue
            if st in (0xF0, 0xF7):
                l, i = vlq(body, i); i += l
                continue
            hi = st & 0xF0
            if hi in (0x80, 0x90, 0xA0, 0xB0, 0xE0):
                n1 = body[i]; i += 1
                if hi in (0x80, 0x90, 0xA0):
                    n2 = body[i]; i += 1
                else:
                    n2 = body[i] if hi == 0xB0 else 0; i += 1
                if hi == 0x90 and n2 > 0:
                    pend.setdefault(n1, []).append((tk, n2))
                elif hi == 0x80 or (hi == 0x90 and n2 == 0):
                    if pend.get(n1):
                        s, v = pend[n1].pop(0)
                        rows.append((s, tk - s, t, n1, v))
            else:
                i += 1
        t += 1

    rows.sort(key=lambda r: (r[0], r[2], r[3]))
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('# Mutopia-2015/08/18-931 -- Fur Elise, WoO 59 (LilyPond MIDI)\n')
        f.write('# source: fur_Elise_WoO59.mid  sha256 of .ly sibling: 828a7bd1b42e441fe1b0eb0389ba46f1502dab28bbe488389e635fb446ba7a67\n')
        f.write('# midi format=%d tracks=%d division=%d (ticks per quarter note)\n' % (fmt, ntrk, div))
        f.write('# track=0 -> RH (MIDI track 1), track=1 -> LH (MIDI track 2)\n')
        f.write('# NOTE: the MIDI has the two repeats WRITTEN OUT, so tick positions run\n')
        f.write('#       continuously past the printed bar numbers. Total %d note events.\n' % len(rows))
        f.write('# pitch is given as name and raw MIDI number; duration is in ticks.\n')
        f.write('#\n')
        f.write('tick=%d dur=%d track=%d note=%s midi=%d velocity=%d\n'
                % (rows[0][0], rows[0][1], 0 if rows[0][2] == 1 else 1,
                   nm(rows[0][3]), rows[0][3], rows[0][4]))
        for s, du, tr, p, v in rows[1:]:
            f.write('tick=%d dur=%d track=%d note=%s midi=%d velocity=%d\n'
                    % (s, du, 0 if tr == 1 else 1, nm(p), p, v))
    print('wrote %s : %d note events' % (OUT, len(rows)))
    return rows


if __name__ == '__main__':
    main()
