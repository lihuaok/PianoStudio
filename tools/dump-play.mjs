/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const esb = path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild')

function bundle(entry, out) {
  execFileSync(process.execPath, [esb, entry, '--bundle', '--format=esm', '--platform=node', '--outfile=' + out, '--log-level=error'], { stdio: 'inherit' })
  if (!fs.existsSync(out)) throw new Error('esbuild 未产出：' + out)
}
bundle(path.join(root, 'src', 'core', 'interpretation.ts'), path.join(root, '_d1.mjs'))
bundle(path.join(root, 'src', 'data', 'furElise.ts'), path.join(root, '_d2.mjs'))

const interp = await import('file:///' + path.join(root, '_d1.mjs').replace(/\\/g, '/'))
const { furElise } = await import('file:///' + path.join(root, '_d2.mjs').replace(/\\/g, '/'))

const score = interp.buildAutoPlayScore(furElise, { rubato: false })
console.log('totalBeats=%s startBeat=%s spanBeats=%s measureCount=%s beatsPerMeasure=%s notes=%s pedals=%s phrases=%s',
  score.totalBeats, score.startBeat, score.spanBeats, score.measureCount, score.beatsPerMeasure, score.notes.length, score.pedals.length, score.phrases.length)

const N = (m) => {
  const names = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B']
  return names[m % 12] + (Math.floor(m / 12) - 1)
}

const maxBeats = Number(process.argv[2] ?? 24)
console.log('\n--- beat | hand | note | midi | dur | vel ---')
for (const n of score.notes.filter(n => n.beat < maxBeats)) {
  console.log('%s\t%s\t%s\t%s\t%s\t%s%s',
    n.beat.toFixed(3), n.hand, n.midis.map(N).join(','), n.midis.join('/'), n.durBeats.toFixed(3), n.velocity.toFixed(3), n.ornament ? '\t[orn]' : '')
}
