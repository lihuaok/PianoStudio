# Copyright (c) 2026 LIHUA. All rights reserved.
# 版权所有 (C) 2026 LIHUA，保留所有权利。

# -*- coding: utf-8 -*-
"""Write the mm.1-26 per-measure table (both hands) derived from the
Mutopia LilyPond source. Provenance and confidence are stated in the header."""
import os, final2 as F

UP = F.run('up')
DN = F.run('down')
OUT = 'tools/scoredata/fur_elise_notes.txt'

HDR = """Fuer Elise (Bagatelle No. 25 in A minor, WoO 59) -- measures 1-26, both hands
================================================================================
SOURCE
  Mutopia Project, Mutopia-2015/08/18-931
  typeset by Stelios Samelis; engraved from Breitkopf & Haertel 1888 (Serie 25).
  https://mutopiaproject.org/ftp/BeethovenLv/WoO59/fur_Elise_WoO59/fur_Elise_WoO59.ly
  .ly sha256 = 828a7bd1b42e441fe1b0eb0389ba46f1502dab28bbe488389e635fb446ba7a67
  This is an INDEPENDENT line: it is not derived from the Nohl-1867
  transmission that the corrupted abc.musicaviva file (and the saomaicenter
  .mxl, mfiles PDF, IMSLP JF Edition and piano.org copies) all descend from.

READING RULES
  Time signature 3/8. Unit = one 16th note, so one full bar = 6 units.
  A leading anacrusis of one 8th (2 units) is numbered m.0 (the pickup).
  "@n" is the onset position inside the bar, in 16ths (0..5).
  "a" / "b" after the bar number mark the 1st / 2nd ending of an
  \\alternative; both endings occupy the SAME printed bar number.
  A bar that is not 6 units long is flagged "<<holds n/6>>" -- this happens
  only where the engraving itself prints a short bar (the 2nd endings).

VERIFICATION PERFORMED
  * Right hand mm.1-7: every bar byte-identical (onset, duration, pitch) to
    the MIDI that LilyPond generated from this same .ly file. 6/6 bars.
  * Left hand mm.1-7: 4/6 byte-identical; the 2 non-identical bars (2 and 6)
    are the notated MULTI-BAR RESTS, which by definition emit no MIDI notes.
  * Bar grid: the RH and LH bar starts agree on the absolute timeline through
    the whole A section, which independently confirms the numbering.
  * Cross-checked against the abc.musicaviva ABC for mm.9-11 pitch content
    (LH C-E-C / G-G-B / A-E-A ; RH E5-G4-F5-E5 etc.) -- agreement.

CONFIDENCE
  mm.1-22 (A section, both hands)  : HIGH
  mm.23-26 (start of B section)   : MEDIUM
      The note CONTENT is taken directly from the .ly and is sound, but the
      printed BAR NUMBER in the B section is not fully verified: the RH/LH
      bar grids begin to diverge by 3 sixteenths at m.23 because of how the
      triplet / grace-note / multi-measure-rest spans were parsed. Treat the
      bar numbers in mm.23-26 as provisional and re-check against the PDF
      (fur_Elise_WoO59-a4.pdf) before relying on them.
  Nothing in this file is reconstructed from memory; every note comes from
  the byte-verified .ly source.

LEGEND
  rest[..]@n     explicit rest of the given duration
  FULL MEASURE REST   notated multi-bar rest (no MIDI note is emitted)
  CHORD{..}      simultaneous pitches sharing one duration
  [clef x]      the staff changes clef at this bar
"""


def bars_of(BS):
    return [(n, ev, cl, alt) for n, ev, cl, alt, st in BS]


def main():
    os.makedirs(os.path.dirname(OUT), exist_ok=True)
    lines = [HDR]
    for tag, BS in (('RIGHT HAND (treble staff)', UP), ('LEFT HAND (bass staff)', DN)):
        lines.append('')
        lines.append('#' * 78)
        lines.append('# %s' % tag)
        lines.append('#' * 78)
        for n, ev, cl, alt in bars_of(BS):
            if n > 26:
                continue
            lab = {0: ' ', 1: 'a', 2: 'b'}.get(alt, '?')
            if not ev:
                lines.append('m.%-3d %s  FULL MEASURE REST (multi-bar rest)' % (n, lab))
                continue
            parts = []
            for o, t, d, rest in ev:
                if rest:
                    parts.append('rest[%-9s]@%d' % (F.dw(d), o))
                elif t.startswith('<'):
                    ps = [F.midi_of(x) for x in t.strip('<> ').split()]
                    ps = [x for x in ps if x is not None]
                    parts.append('CHORD{%s}[%-9s]@%d'
                                 % (','.join(F.nm(x) for x in ps), F.dw(d), o))
                else:
                    parts.append('%-4s[%-9s]@%d' % (F.nm(F.midi_of(t)), F.dw(d), o))
            tot = sum(x[2] for x in ev)
            fl = '' if abs(tot - 6) < 1e-9 else '   <<holds %g/6>>' % tot
            cc = '  [clef %s]' % cl if cl else ''
            lines.append('m.%-3d %s %s%s%s' % (n, lab, '  '.join(parts), fl, cc))
    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write('\n'.join(lines) + '\n')
    print('wrote %s : %d lines' % (OUT, len(lines)))


if __name__ == '__main__':
    main()
