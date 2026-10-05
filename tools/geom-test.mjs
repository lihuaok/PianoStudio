/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * 乐谱几何校验：确认音符在谱表上的落点符合真实记谱规则。
 * 这是比肉眼看截图可靠得多的验证方式。
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'src', 'data', 'furElise.json'), 'utf8'))

// 与 core/score.ts 相同的几何公式
const LETTER_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const LETTERS = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

function midiToPitchName(midi) {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  const pc = ((midi % 12) + 12) % 12
  const oct = Math.floor(midi / 12) - 1
  return { letter: names[pc][0], alter: names[pc].length > 1 ? (names[pc][1] === '#' ? 1 : -1) : 0, oct, name: `${names[pc]}${oct}` }
}
function absoluteStep(midi) {
  const p = midiToPitchName(midi)
  return p.oct * 7 + LETTERS.indexOf(p.letter)
}
const TREBLE_TOP = 38 // F5
const BASS_TOP = 26    // A3
const s = 10
function trebleY(m) { return (TREBLE_TOP - absoluteStep(m)) * (s / 2) }
function bassY(m) { return (BASS_TOP - absoluteStep(m)) * (s / 2) }
function isBass(m) { return absoluteStep(m) <= BASS_TOP }

// 参考位置（真实记谱）：
//  高音谱表 线(下→上)：E4 G4 B4 D5 F5 ；间(下→上)：F4 A4 C4?→ C5 E5
//  低音谱表 线(下→上)：G2 B2 D3 F3 A3 ；间(下→上)：A2 C3 E3 G3
//  y 约定：顶线 = 0，向下递增，每「字母级」= lineSpacing/2
const CASES = [
  ['F5', 'treble', 0,  '高音表 顶线'],
  ['E5', 'treble', 5,  '高音表 第4间（顶间）'],
  ['D5', 'treble', 10, '高音表 第4线'],
  ['C5', 'treble', 15, '高音表 第3间'],
  ['B4', 'treble', 20, '高音表 中线'],
  ['A4', 'treble', 25, '高音表 第2间'],
  ['G4', 'treble', 30, '高音表 第2线'],
  ['F4', 'treble', 35, '高音表 第1间'],
  ['E4', 'treble', 40, '高音表 底线'],
  ['C4', 'treble', 50, '高音表 下加一线'],
  ['A3', 'bass',   0,  '低音表 顶线'],
  ['G3', 'bass',   5,  '低音表 第4间'],
  ['F3', 'bass',   10, '低音表 第4线'],
  ['E3', 'bass',   15, '低音表 第3间'],
  ['D3', 'bass',   20, '低音表 中线'],
  ['C3', 'bass',   25, '低音表 第2间'],
  ['B2', 'bass',   30, '低音表 第2线'],
  ['A2', 'bass',   35, '低音表 第1间'],
  ['G2', 'bass',   40, '低音表 底线'],
  ['G#3', 'bass',  5,  '低音表 第4间（G♯不改字母位置）'],
  ['C#5', 'treble', 15, '高音表 第3间（C♯不改字母位置）'],
]

function midiFromName(name) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name)
  if (!m) return null
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  const oct = parseInt(m[3], 10)
  return (oct + 1) * 12 + LETTER_SEMI[m[1]] + alter
}

const out = []
let fail = 0
out.push('=== 乐谱几何校验（谱表落点） ===')
for (const [name, expectStaff, expectY, desc] of CASES) {
  const midi = midiFromName(name)
  const bass = isBass(midi)
  const y = bass ? bassY(midi) : trebleY(midi)
  const staff = bass ? 'bass' : 'treble'
  const okStaff = staff === expectStaff
  const okY = Math.abs(y - expectY) < 0.01
  if (!okStaff || !okY) fail++
  out.push(
    `${okStaff && okY ? '✓' : '✗'} ${name.padEnd(5)} → ${staff.padEnd(7)} y=${String(y).padStart(4)}  期望 ${expectStaff.padEnd(7)} y=${String(expectY).padStart(4)}   ${desc}`,
  )
}

// 校验《致爱丽丝》开头的实际音符落点
out.push('')
out.push('=== 《致爱丽丝》第 1 小节实际落点 ===')
const m1 = raw.notes.filter((n) => n.measure === 1)
const NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
for (const n of m1.sort((a, b) => a.hand.localeCompare(b.hand) || a.onset - b.onset)) {
  const pc = ((n.midi % 12) + 12) % 12
  const nm = `${NAMES[pc]}${Math.floor(n.midi / 12) - 1}`
  const bass = isBass(n.midi)
  const y = bass ? bassY(n.midi) : trebleY(n.midi)
  out.push(`  ${n.hand.padEnd(6)} ${nm.padEnd(5)} 谱表=${(bass ? 'bass' : 'treble').padEnd(7)} y=${String(y).padStart(4)}  时值=${n.duration}t  小节内位置=${n.onset}t`)
}

// 校验符干方向
out.push('')
out.push('=== 符干方向（中线以上向下，以下向上） ===')
for (const midi of [76, 74, 72, 71, 69, 65, 64, 60, 57, 55, 52, 45]) {
  const bass = isBass(midi)
  const y = bass ? bassY(midi) : trebleY(midi)
  const stemUp = y < s * 2
  const pc = ((midi % 12) + 12) % 12
  const nm = `${NAMES[pc]}${Math.floor(midi / 12) - 1}`
  out.push(`  ${nm.padEnd(5)} ${bass ? 'bass' : 'treble'} y=${String(y).padStart(4)} → 符干${stemUp ? '向上' : '向下'}`)
}

out.push('')
out.push(fail === 0 ? '✅ 全部通过' : `❌ ${fail} 项失败`)

fs.writeFileSync(path.join(__dirname, '..', '_geom_test.txt'), out.join('\n'), 'utf8')
console.log(out.join('\n'))
