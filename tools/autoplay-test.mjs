/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * 自动演奏诠释层单元测试
 *
 * 做法：用 esbuild 把 src/core/interpretation.ts（连同 score / furElise 数据）打成临时 ESM，
 * 再由 node 直接 import —— 测的是**真实实现**，不是复刻逻辑。
 *
 * 运行：node tools/autoplay-test.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const tmp = path.join(root, '_tmp_interp.mjs')
const tmpPiece = path.join(root, '_tmp_piece.mjs')
const esbuildBin = path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild')

/** 用 esbuild 把 TS（含 @/ 别名 + JSON 导入）打成临时 ESM */
function bundle(entry, out) {
  execFileSync(process.execPath, [esbuildBin, entry, '--bundle', '--format=esm', '--platform=node',
    `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' })
  if (!fs.existsSync(out)) throw new Error('esbuild 未产出：' + out)
}

const load = (p) => import('file:///' + p.replace(/\\/g, '/'))

bundle(path.join(root, 'src', 'data', 'furElise.ts'), tmpPiece)
bundle(path.join(root, 'src', 'core', 'interpretation.ts'), tmp)

const { furElise } = await load(tmpPiece)
const { buildAutoPlayScore, estimateDuration, noteIndexAtBeat } = await load(tmp)

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
}

console.log('\n自动演奏诠释层测试')
console.log('─'.repeat(60))

const score = buildAutoPlayScore(furElise, {})
const { notes, pedals, phrases } = score

// 1. 规模
ok('音符数 = 乐谱音符数', notes.length === furElise.notes.length, `${notes.length}`)
// 期望值全部**从乐谱推导**，不再写死数字：
// 2026-10-05 修完 LilyPond 解析器的一批 bug 后，小节数从 105 变成真实的 124，
// 写死的常量会让人误以为解析器又坏了。
const lastMeasure = Math.max(...furElise.notes.map((n) => n.measure))
ok('小节覆盖到曲末', score.measureCount === lastMeasure + 1, `measureCount=${score.measureCount}（乐谱末小节 ${lastMeasure}）`)

// 2. 时间轴
let monotonic = true
for (let i = 1; i < notes.length; i++) if (notes[i].beat < notes[i - 1].beat - 1e-9) { monotonic = false; break }
ok('拍点严格单调递增（rubato 后仍成立）', monotonic)

const totalBeats = score.totalBeats
const expectBeats = (lastMeasure + 1) * 3 // 3/8 拍：每小节 3 拍
ok('总拍数 ≈ 小节数 × 3 拍', Math.abs(totalBeats - expectBeats) < 6,
  `${totalBeats.toFixed(1)} 拍（预期 ≈${expectBeats}）`)

const durDefault = estimateDuration(score, 126) // 126 八分/分 ≈ ♩=63
ok('默认速度下时长 ≈ 3 分钟', durDefault > 160 && durDefault < 200,
  `${Math.floor(durDefault / 60)}:${String(Math.round(durDefault % 60)).padStart(2, '0')}`)

// 3. 力度
const vels = notes.map((n) => n.velocity)
ok('力度全部落在 [0.08, 0.97]', Math.min(...vels) >= 0.08 && Math.max(...vels) <= 0.97,
  `min=${Math.min(...vels).toFixed(2)} max=${Math.max(...vels).toFixed(2)}`)
const rh = notes.filter((n) => n.hand === 'right')
const lh = notes.filter((n) => n.hand === 'left')
const avg = (a) => a.reduce((s, x) => s + x.velocity, 0) / a.length
ok('右手平均力度 > 左手（声部平衡）', avg(rh) > avg(lh), `RH=${avg(rh).toFixed(3)} LH=${avg(lh).toFixed(3)}`)

// 曲式力度层次：C 段 > A 段，尾声 < C 段。
// 段落边界从 furElise.sections 取，不写死 —— 写死的数字在解析器修好后必然失效。
const inRange = (m0, m1) => notes.filter((n) => n.measure >= m0 && n.measure <= m1)
const secOf = (pred) => {
  const s = furElise.sections.find(pred)
  return s ? inRange(s.startMeasure, s.endMeasure) : []
}
const aSeg = secOf((s) => s.form.startsWith('A') && s.startMeasure <= 2)
const cSeg = secOf((s) => s.form === 'C')
const codaSeg = secOf((s) => s.form.includes('尾声'))
ok('曲式段落都能在乐谱里定位到', aSeg.length > 0 && cSeg.length > 0 && codaSeg.length > 0,
  `A=${aSeg.length} C=${cSeg.length} 尾声=${codaSeg.length} 音`)
ok('C 段（高潮）力度 > A 段', avg(cSeg) > avg(aSeg), `C=${avg(cSeg).toFixed(3)} A=${avg(aSeg).toFixed(3)}`)
ok('尾声力度 < C 段', avg(codaSeg) < avg(cSeg), `尾声=${avg(codaSeg).toFixed(3)}`)

// 4. 乐句
// 乐句数量：随小节数增长，按"平均每 2~3 小节一句"来判，而不是写死上限
ok('乐句数量合理', phrases.length >= 8 && phrases.length <= Math.ceil(lastMeasure * 1.2),
  `${phrases.length} 句 / ${lastMeasure} 小节`)
const badLen = phrases.filter((p) => p.endMeasure - p.startMeasure + 1 > 8 || p.endMeasure < p.startMeasure)
ok('每句长度 ≤ 8 小节', badLen.length === 0)

// 5. 踏板
ok('踏板事件已生成', pedals.length > 0, `${pedals.length} 段`)
const pedalOrdered = pedals.every((p, i) => p.upBeat > p.downBeat && (i === 0 || p.downBeat >= pedals[i - 1].downBeat))
ok('踏板区间合法且有序', pedalOrdered)
const covered = notes.filter((n) => n.pedalDown).length / notes.length
ok('多数音符带踏板（延音）', covered > 0.5, `${(covered * 100).toFixed(1)}% 音符踩着踏板`)
const half = pedals.filter((p) => p.kind === 'half').length
ok('密集段落降级为半踏板（防糊）', half > 0, `${half} 段半踏板`)
const cadence = pedals.filter((p) => p.kind === 'cadence')
ok('曲末有收束长踏板', cadence.length === 1)

// 6. 装饰音
const orn = notes.filter((n) => n.ornament)
// 装饰音：数量以乐谱里实际标记的为准（倚音 2 个 + 倚倚音 1 个），并要求力度确实更轻
ok('装饰音被识别并轻奏',
  orn.length === furElise.notes.filter((n) => n.ornament).length && orn.length > 0 &&
  orn.every((n) => n.velocity < 0.6),
  `${orn.length} 个（乐谱标记 ${furElise.notes.filter((n) => n.ornament).length} 个）`)

// 7. seek
const idx = noteIndexAtBeat(notes, 100)
ok('按拍定位音符索引正确', idx >= 0 && notes[idx].beat <= 100 && (idx + 1 >= notes.length || notes[idx + 1].beat > 100))

// 8. 可复现性（固定 seed）
const again = buildAutoPlayScore(furElise, {})
ok('固定种子 → 演奏完全可复现', again.notes[300].velocity === notes[300].velocity && again.totalBeats === totalBeats)

// 9. 结构基调
const cTone = phrases.filter((p) => p.form.includes('C'))[0]
const aTone = phrases.filter((p) => p.form.includes('A'))[0]
ok('曲式基调：C 段 > A 段', !!cTone && !!aTone && cTone.tone > aTone.tone, `C=${cTone?.tone} A=${aTone?.tone}`)

// 清理
for (const f of [tmp, tmpPiece]) { try { fs.unlinkSync(f) } catch { /* noop */ } }

console.log('─'.repeat(60))
console.log(`通过 ${pass} / ${pass + fail}\n`)
process.exit(fail ? 1 : 0)
