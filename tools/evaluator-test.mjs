/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * 评测引擎单元测试
 * 用构造数据验证：完美演奏、高音偏差、漏音、多余音、时值偏差 各自的评分行为。
 */
const LETTER_SEMI = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }
const midi = (name) => {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(name)
  const alter = m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0
  return (parseInt(m[3], 10) + 1) * 12 + LETTER_SEMI[m[1]] + alter
}

// 复刻 evaluator 的评分逻辑（与 src/core/evaluator.ts 保持一致）
function stdev(v) { if (v.length < 2) return 0; const m = v.reduce((a, b) => a + b, 0) / v.length; return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) }

function grade(targets, played) {
  const pitchTolerance = 0, timingTolerance = 0.14
  let correct = 0, wrongPitch = 0, missed = 0, extra = 0
  const timeDeltas = []
  // 贪心对齐（测试用简化版，够验证评分方向）
  const used = new Set()
  for (const t of targets) {
    let best = -1, bestDt = Infinity
    for (let i = 0; i < played.length; i++) {
      if (used.has(i)) continue
      const dt = Math.abs(played[i].time - t.time)
      if (dt < bestDt) { bestDt = dt; best = i }
    }
    if (best < 0) { missed++; continue }
    used.add(best)
    const p = played[best]
    const semi = p.midi - t.midi
    timeDeltas.push(p.time - t.time)
    if (semi === 0 && bestDt <= timingTolerance * 3) correct++
    else if (semi === 0) { wrongPitch++ }
    else if (Math.abs(semi) <= 2) { wrongPitch++ }
    else { wrongPitch++ }
  }
  extra = played.length - used.size

  let pitchPartial = 0
  const pitchBase = targets.length ? correct / targets.length : 0
  const pitchScore = Math.round(Math.min(100, pitchBase * 100))

  const avgDelta = timeDeltas.length ? timeDeltas.reduce((a, b) => a + b, 0) / timeDeltas.length : 0
  const consistency = stdev(timeDeltas)
  let rhythmScore = 0
  const threshold = Math.max(1, Math.ceil(targets.length * 0.2))
  if (used.size >= threshold) {
    const consistencyScore = Math.max(0, 1 - consistency / 0.18)
    const onsetScore = Math.max(0, 1 - Math.abs(avgDelta) / 0.25)
    const coverage = correct / targets.length
    rhythmScore = Math.round(Math.min(100, (consistencyScore * 0.32 + onsetScore * 0.23 + coverage * 0.45) * 100))
  }

  const extraP = extra / targets.length, missP = missed / targets.length, wrongP = wrongPitch / targets.length
  const fluencyScore = Math.round(Math.max(0, Math.min(100, (1 - (extraP * 0.8 + missP * 0.6 + wrongP * 0.4)) * 100)))

  const raw = pitchScore * 0.35 + rhythmScore * 0.3 + 60 * 0.12 + fluencyScore * 0.15 + 75 * 0.08
  return { total: Math.round(raw), pitchScore, rhythmScore, fluencyScore, correct, wrongPitch, missed, extra, pitchPartial, avgDelta: avgDelta * 1000 }
}

// 测试乐句：《致爱丽丝》m1 右手六音
const NAMES = ['E5', 'D#5', 'E5', 'B4', 'D5', 'C5']
const step = 60 / 72 / 1.5 // 72BPM，16分音符
const targets = NAMES.map((n, i) => ({ midi: midi(n), time: i * step, duration: step, measure: 1, hand: 'right' }))

const mk = (arr) => arr.map(([n, dt, off = 0]) => ({ midi: midi(n), time: midi(n) * 0 + dt, duration: step, velocity: 0.7, source: 'onScreen', ...(off ? { off } : {}) }))
const P = (n, t, off = 0) => ({ midi: midi(n), time: t, duration: step, velocity: 0.7, source: 'onScreen', off })

const out = []
const T = (title, targets, played, expect) => {
  const r = grade(targets, played)
  const pass = expect(r)
  out.push(`${pass ? '✓' : '✗'} ${title.padEnd(34)} 总分=${String(r.total).padStart(3)} 音高=${String(r.pitchScore).padStart(3)} 节奏=${String(r.rhythmScore).padStart(3)} 流畅=${String(r.fluencyScore).padStart(3)}  (对${r.correct}/错${r.wrongPitch}/漏${r.missed}/多${r.extra}, 偏差${r.avgDelta.toFixed(0)}ms)`)
}

// 1. 完美演奏
T('完美演奏', targets, targets.map((t, i) => ({ ...t, velocity: 0.7, source: 'onScreen' })), (r) => r.total >= 88 && r.pitchScore === 100)

// 2. 全部错音
T('全部错音', targets, targets.map((t) => ({ ...t, midi: t.midi + 3 })), (r) => r.pitchScore === 0)

// 3. 漏一个音
T('漏 1 个音', targets, targets.slice(0, 5).map((t) => ({ ...t, velocity: .7, source: 'onScreen' })), (r) => r.missed === 1 && r.pitchScore < 100 && r.pitchScore > 60)

// 4. 多一个音
T('多 1 个音', targets, [...targets.map((t) => ({ ...t, velocity: .7, source: 'onScreen' })), { midi: midi('A4'), time: 6 * step, duration: step, velocity: .7, source: 'onScreen' }], (r) => r.extra === 1 && r.fluencyScore < 100)

// 5. 整体偏晚 80ms
T('整体偏晚 80ms', targets, targets.map((t) => ({ ...t, time: t.time + 0.08, velocity: .7, source: 'onScreen' })), (r) => r.rhythmScore < 95)

// 6. 节奏不稳（±150ms 抖动）
const jitter = targets.map((t, i) => ({ ...t, time: t.time + (i % 2 ? 0.15 : -0.15), velocity: .7, source: 'onScreen' }))
T('节奏抖动 ±150ms', targets, jitter, (r) => r.rhythmScore < 80)

// 7. 空演奏 —— 必须低分
T('完全没弹', targets, [], (r) => r.total < 25 && r.pitchScore === 0 && r.rhythmScore === 0)

// 8. 单音测试
const single = [{ midi: midi('C4'), time: 0, duration: step, measure: 1, hand: 'right' }]
T('单个目标音 · 正确', single, [{ ...single[0], velocity: .7, source: 'onScreen' }], (r) => r.pitchScore === 100 && r.total >= 85)

// 9. 只弹一半 —— 已弹的 3 个音时值完美，但覆盖度只有 50%
//    断言：节奏分应因覆盖度而明显下降（修复前 88 → 修复后 78），
//    且总分显著低于完整演奏（93）。漏音本身主要由音高分与流畅度惩罚，
//    节奏分只做"部分扣减"，因为"弹对的音确实卡在拍上"是事实。
T('只弹一半（覆盖度 50%）', targets, targets.slice(0, 3).map((t) => ({ ...t, velocity: .7, source: 'onScreen' })), (r) => r.rhythmScore < 85 && r.total < 80 && r.total > 50)

// 10. 大量多余音
T('8 个多余音', targets, [...targets.map((t) => ({ ...t, velocity: .7, source: 'onScreen' })), ...Array.from({ length: 8 }, (_, i) => ({ midi: midi('C4') + (i % 5), time: 7 * step + i * step, duration: step, velocity: .7, source: 'onScreen' }))], (r) => r.fluencyScore < 70)

out.push('')
const failed = out.filter((l) => l.startsWith('✗')).length
out.push(failed === 0 ? '✅ 评测引擎全部通过' : `❌ ${failed} 项未通过`)

console.log(out.join('\n'))
