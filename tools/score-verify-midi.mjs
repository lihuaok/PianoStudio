/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * score-verify-midi.mjs — 用官方 MIDI 逐音校验乐谱 JSON
 *
 * 背景：2026-10-05 修掉了一批致命解析器 bug（详见 tools/lilypond-to-score.mjs 注释），
 *   1) lilyAlter 正则取错捕获组 → 全曲升号被吞，D♯/G♯ 退化成 D/G
 *   2) 大写 R（全小节休止）被当 skip 且不推进时间 → 左手整体前移一小节
 *   3) \pp 这类无参命令吞掉后随的 R4. → 左手丢失整段休止
 *   4) tokenize 按行切分 → 跨行的 \repeat volta 2 { ... } 连同内容被丢弃
 *   5) main() 从 \partial 处切 staff → 第一个反复声明被切掉
 *   6) Scheme 表达式 #(ly:make-moment ...) 里的字母被当音符 → 凭空多出 A3/E3/E3
 *
 * 校验策略（两级）：
 *   A. 折叠模式生成的数据  ≡  LilyPond 直接输出的官方 MIDI（逐音全等：位置/时值/音高）
 *      ——官方 MIDI 不展开 volta，所以这里必须用 --collapse-repeats 生成的同构数据比
 *   B. 演奏用的展开版  =  折叠版 + 各反复段的 body 副本（结构断言 + 数量守恒）
 *
 * 运行：node tools/score-verify-midi.mjs
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseMidiFile, noteName } from './midi-read.mjs'
import { main as buildScore } from './lilypond-to-score.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const NODE = process.execPath
const key = (n) => `${n.tick}|${n.dur}|${n.midi}`

const MID = path.join(root, 'tools', 'scoredata', 'fur_Elise_WoO59.mid')
const PLAY_JSON = path.join(root, 'src', 'data', 'furElise.json')
const TMP_JSON = path.join(root, '_verify_collapsed.json')

const SCALE = 16 // 乐谱 tick(6/十六分) → MIDI tick(384/四分)：384 / 24

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
}

console.log('参照：' + path.relative(root, MID))
const { division, tracks } = parseMidiFile(MID)
ok('MIDI 分辨率符合预期', division === 384, `division=${division}`)

const refRH = tracks[1].map((n) => ({ tick: n.tick, dur: n.dur, midi: n.midi }))
const refLH = tracks[2].map((n) => ({ tick: n.tick, dur: n.dur, midi: n.midi }))
console.log(`  官方 MIDI：${refRH.length + refLH.length} 音（RH ${refRH.length} / LH ${refLH.length}）\n`)

// ── A. 折叠模式 vs 官方 MIDI ────────────────────────────────────────────────
console.log('A. 折叠模式（复刻 official MIDI 形态）')
// 直接 import 调用（沙箱里 spawnSync 会报 EBUSY，且同进程调用更快）
const collapsed = buildScore({ collapse: true, quiet: true, out: TMP_JSON, })
/**
 * 生成的一串音符 → 与 MIDI 同构的音事件流。
 * 注意：MIDI 里一个和弦是**多个独立 note-on**，而我们的 JSON 把它记成
 * 「一个音符 + chord 数组」，所以这里必须把和弦展开，否则比对全是假阴性。
 */
function toGen(notes) {
  const out = []
  for (const n of notes) {
    const members = n.chord && n.chord.length > 1 ? n.chord : [n.midi]
    for (const midi of members) {
      out.push({ tick: n.absTick * SCALE, dur: n.duration * SCALE, midi, ornament: n.ornament, slop: n.slop })
    }
  }
  return out.sort((a, b) => a.tick - b.tick || a.midi - b.midi)
}

/**
 * 按「起音点 + 音高」分组比对。
 * 比逐音顺序对齐稳得多：一处错位不会让后面几百个音全部连锁报假错。
 *
 * 容差：装饰音是被挤压出来的短音，长度取决于挤压算法本身，
 * 十几 ticks（<30ms）的差异不影响任何听感，故对 ornament 放行 ±GRACE_TOL。
 */
/**
 * 容差：装饰音是被挤压出来的短音，长度落在 LilyPond 的有理数网格上，
 * 而我们只有 1/24 四分音符的内部刻度，位置和长度差几 ticks（约 10ms）
 * 不属于错音；排序并对 forcing 精确比对没有意义，故对 ornament 放行 ±GRACE_TOL。
 */
const GRACE_TOL = 16
function compareBySlot(ref, mine, label) {
  const slot = (arr) => {
    const m = new Map()
    for (const n of arr) {
      const k = `${n.tick}|${n.midi}`
      if (!m.has(k)) m.set(k, [])
      m.get(k).push(n)
    }
    return m
  }
  const R = slot(ref)
  const M = slot(mine)
  const missing = []
  const extra = []
  const wrongDur = []
  for (const [k, rs] of R) {
    const ms = M.get(k)
    if (!ms || ms.length !== rs.length) { missing.push([k, rs[0]]); continue }
    const tol = ms[0].ornament || ms[0].slop ? GRACE_TOL : 0
    for (let i = 0; i < rs.length; i++) {
      if (Math.abs(rs[i].dur - ms[i].dur) > tol) wrongDur.push([k, rs[i].dur, ms[i].dur, !!(ms[i].ornament || ms[i].slop)])
    }
  }
  for (const [k, ms] of M) if (!R.has(k)) extra.push([k, ms[0]])

  // 第二遍：装饰音允许起音点有几 ticks 的偏差。
  // 我们的内部时间刻度是 16 MIDI ticks（1/24 四分音符），而 LilyPond 用有理数记谱，
  // 挤压出来的倚音落点差 4~6 ticks（约 10ms）—— 听不出来，但逐位字符串比对会说不匹配。
  const gracePaired = []
  if (missing.length && extra.length) {
    for (let i = missing.length - 1; i >= 0; i--) {
      const [k, rn] = missing[i]
      const rt = Number(k.split('|')[0])
      const hitIdx = extra.findIndex(([k2, mn]) => {
        if (k2.split('|')[1] !== k.split('|')[1]) return false
        if (!mn.ornament) return false
        return Math.abs(Number(k2.split('|')[0]) - rt) <= GRACE_TOL
      })
      if (hitIdx >= 0) {
        gracePaired.push([k, extra[hitIdx][0]])
        missing.splice(i, 1)
        extra.splice(hitIdx, 1)
      }
    }
  }
  const graceDurOk = wrongDur.every((d) => d[3])

  const totalSlots = new Set([...R.keys(), ...M.keys()]).size
  ok(`${label} 每个「起音点 + 音高」都对得上`, missing.length === 0 && extra.length === 0,
    missing.length || extra.length
      ? `缺失 ${missing.length} / 多出 ${extra.length}（共 ${totalSlots} 个发音点）`
      : `${totalSlots} / ${totalSlots}${gracePaired.length ? `（含 ${gracePaired.length} 个装饰音容差配对）` : ''}`)
  ok(`${label} 每个音的时值与官方一致`, wrongDur.length === 0,
    wrongDur.length ? `${wrongDur.length} 个不一致${graceDurOk ? '（均为装饰音）' : ''}` : `${ref.length} / ${ref.length}`)
  if (missing.length) {
    console.log('    官方有、我们没有（前 8）：')
    for (const [k, n] of missing.slice(0, 8)) console.log(`      ${k} → ${noteName(n.midi)} dur ${n.dur}`)
  }
  if (extra.length) {
    console.log('    我们多出来（前 8）：')
    for (const [k, n] of extra.slice(0, 8)) console.log(`      ${k} → ${noteName(n.midi)} dur ${n.dur}`)
  }
  if (wrongDur.length) {
    console.log('    时值不符（前 8）：')
    for (const [k, x, y, g] of wrongDur.slice(0, 8)) console.log(`      ${k} 官方 ${x} vs 我们 ${y}${g ? '  [装饰音]' : ''}`)
  }
}

for (const [label, ref, mine] of [
  ['RH', refRH, toGen(collapsed.notes.filter((n) => n.hand === 'right'))],
  ['LH', refLH, toGen(collapsed.notes.filter((n) => n.hand === 'left'))],
]) {
  console.log(`  ${label}：参照 ${ref.length} · 生成 ${mine.length}`)
  compareBySlot(ref, mine, label)
}

// ── B. 展开版结构断言 ───────────────────────────────────────────────────────
console.log('\nB. 演奏用的展开版')
const play = JSON.parse(fs.readFileSync(PLAY_JSON, 'utf8'))
const playRH = play.notes.filter((n) => n.hand === 'right')
const playLH = play.notes.filter((n) => n.hand === 'left')
const colRH = collapsed.notes.filter((n) => n.hand === 'right')
const colLH = collapsed.notes.filter((n) => n.hand === 'left')
console.log(`  展开版 ${play.notes.length} 音（RH ${playRH.length} / LH ${playLH.length}）· 折叠版 ${collapsed.notes.length} 音`)

ok('展开版音符多于折叠版（反复被奏出）', play.notes.length > collapsed.notes.length,
  `${play.notes.length} > ${collapsed.notes.length}`)
ok('展开版保留了折叠版的全部音高素材', (() => {
  const playPitches = new Set()
  for (const n of play.notes) {
    for (const m of n.chord && n.chord.length > 1 ? n.chord : [n.midi]) playPitches.add(m)
  }
  const lostSet = new Set()
  for (const n of collapsed.notes) {
    for (const m of n.chord && n.chord.length > 1 ? n.chord : [n.midi]) if (!playPitches.has(m)) lostSet.add(m)
  }
  const lost = [...lostSet]
  if (lost.length) console.log(`    折叠版有、展开版没有的音高：${lost.map(noteName).join(' ')}`)
  return lost.length === 0
})())
ok('展开版小节数多于折叠版', play.notes.length > 0 && Math.max(...play.notes.map((n) => n.measure)) > Math.max(...collapsed.notes.map((n) => n.measure)),
  `${Math.max(...play.notes.map((n) => n.measure))} > ${Math.max(...collapsed.notes.map((n) => n.measure))}`)

// 展开版的开头必须与官方 MIDI 一致（最有辨识度的主题动机）
const headOk = (() => {
  const ref0 = refRH.slice(0, 12)
  const mine0 = toGen(playRH).slice(0, 12)
  return ref0.length === mine0.length && ref0.every((r, i) => key(r) === key(mine0[i]))
})()
ok('展开版的曲首动机与官方 MIDI 一致', headOk)

const blackRef = refRH.concat(refLH).filter((n) => [1, 3, 6, 8, 10].includes(n.midi % 12)).length
const blackPlay = play.notes.filter((n) => [1, 3, 6, 8, 10].includes(n.midi % 12)).length
ok('升降号没有被吞（黑键占比接近官方）',
  blackPlay / play.notes.length > (blackRef / (refRH.length + refLH.length)) * 0.7,
  `展开版 ${(blackPlay / play.notes.length * 100).toFixed(1)}% (${blackPlay}) · 官方 ${(blackRef / (refRH.length + refLH.length) * 100).toFixed(1)}% (${blackRef})`)

fs.rmSync(TMP_JSON, { force: true })

console.log(`\n${fail === 0 ? '全部通过' : '存在失败'} — ${pass} passed, ${fail} failed`)
process.exit(fail === 0 ? 0 : 1)
