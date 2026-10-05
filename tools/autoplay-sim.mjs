/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * 自动演奏引擎仿真测试（无需浏览器）
 *
 * 用一套最小 Web Audio 假实现 + 假 window，把 AutoPlayEngine 完整跑一遍全曲，
 * 验证真正重要的东西：
 *   1. 766 个音（含和弦内音）一个不漏、一个不重地被调度
 *   2. 发声时刻写在音频时钟上，且严格单调不回退
 *   3. 结束时刻 ≈ 乐谱时长（速度换算正确）
 *   4. 暂停/继续 不丢音不重音
 *   5. 进度跳转（seek）只播放跳转点之后的音
 *   6. 实时变速：变速后音间隔立即按新速度收缩
 *   7. 踏板 down / up 严格配对，且不会卡在"踩下"状态
 *
 * 运行：node tools/autoplay-sim.mjs
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const esbuildBin = path.join(root, 'node_modules', 'esbuild', 'bin', 'esbuild')

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 假 Web Audio / window
 * ────────────────────────────────────────────────────────────────────────── */
const param = () => {
  const p = { value: 0 }
  const nop = () => p
  p.setValueAtTime = nop
  p.linearRampToValueAtTime = nop
  p.exponentialRampToValueAtTime = nop
  p.setTargetAtTime = nop
  p.cancelScheduledValues = nop
  return p
}
const node = (extra = {}) => ({ connect() {}, disconnect() {}, ...extra })

class FakeAudioContext {
  constructor() {
    this.currentTime = 0
    this.sampleRate = 48000
    this.state = 'running'
    this.destination = node()
  }
  async resume() { this.state = 'running' }
  createGain() { return node({ gain: param() }) }
  createOscillator() { return node({ type: 'sine', frequency: param(), detune: param(), start() {}, stop() {} }) }
  createBiquadFilter() { return node({ type: 'lowpass', frequency: param(), Q: param(), gain: param() }) }
  createStereoPanner() { return node({ pan: param() }) }
  createWaveShaper() { return node({ curve: null, oversample: 'none' }) }
  createConvolver() { return node({ buffer: null }) }
  createDynamicsCompressor() {
    return node({ threshold: param(), knee: param(), ratio: param(), attack: param(), release: param() })
  }
  createBuffer(ch, len, rate) {
    const chans = Array.from({ length: ch }, () => new Float32Array(len))
    return { length: len, numberOfChannels: ch, sampleRate: rate, getChannelData: (i) => chans[i] }
  }
  createBufferSource() {
    return node({ buffer: null, playbackRate: param(), start() {}, stop() {}, onended: null })
  }
  async decodeAudioData(buf) { return this.createBuffer(2, 1024, this.sampleRate) }
}

const intervals = new Map()
let nextId = 1
globalThis.window = {
  AudioContext: FakeAudioContext,
  setInterval: (fn) => { const id = nextId++; intervals.set(id, fn); return id },
  clearInterval: (id) => intervals.delete(id),
  setTimeout: () => 0,
  clearTimeout: () => {},
  addEventListener() {},
  removeEventListener() {},
}
globalThis.requestAnimationFrame = () => 0
globalThis.cancelAnimationFrame = () => {}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 打包真实实现
 * ────────────────────────────────────────────────────────────────────────── */
const entry = path.join(root, '_tmp_sim_entry.ts')
const out = path.join(root, '_tmp_sim.mjs')
fs.writeFileSync(entry, `
export { getAudioEngine } from '@/audio/audioEngine'
export { getAutoPlayEngine } from '@/audio/autoPlayEngine'
export { buildAutoPlayScore } from '@/core/interpretation'
export { furElise } from '@/data/furElise'
`, 'utf8')
execFileSync(process.execPath, [esbuildBin, entry, '--bundle', '--format=esm', '--platform=node',
  `--outfile=${out}`, '--log-level=error'], { stdio: 'inherit' })

const mod = await import('file:///' + out.replace(/\\/g, '/'))
const { getAudioEngine, getAutoPlayEngine, buildAutoPlayScore, furElise } = mod

/* ────────────────────────────────────────────────────────────────────────────
 * 3. 插桩
 * ────────────────────────────────────────────────────────────────────────── */
const engine = getAudioEngine()
let fired = []        // { when, midi, velocity }
let pedalLog = []     // { t, down }
const origNoteOn = engine.noteOn.bind(engine)
engine.noteOn = (midi, opts = {}) => {
  fired.push({ when: opts.when ?? engine.currentTime, midi, velocity: opts.velocity ?? 0.7 })
  return origNoteOn(midi, opts)
}
let firedIdx = []
const origPedal = engine.setSustainPedal.bind(engine)
engine.setSustainPedal = (down) => {
  pedalLog.push({ t: engine.currentTime, down })
  return origPedal(down)
}

const ctx = engine.ctx
const score = buildAutoPlayScore(furElise, {})
const auto = getAutoPlayEngine()
auto.setScore(score)
// 完整性验证阶段关闭踏板共鸣（共鸣音是**额外的**共振音，会干扰"音符数"统计）
auto.applySettings({ bpm: 108, volume: 0.8, reverb: 0.25, resonance: false })

/** 插桩引擎的 fire()：一次 fire = 乐谱上的一个音（和弦内部算一个事件） */
const origFire = Object.getPrototypeOf(auto).fire.bind(auto)
auto.fire = (note, when) => {
  firedIdx.push(note.index)
  return origFire(note, when)
}

const expected = score.notes.reduce((s, n) => s + n.midis.length, 0)

/** 单个 tick 内被调度的音数峰值 —— 证明是"前瞻调度"而非一次性预调度 */
let peakPerTick = 0

/** 推进仿真：每个 tick 把假时钟往前推，并执行引擎注册的 interval 回调 */
function advance(seconds, stepMs = 25) {
  const steps = Math.round((seconds * 1000) / stepMs)
  for (let i = 0; i < steps; i++) {
    ctx.currentTime += stepMs / 1000
    const before = fired.length
    for (const fn of [...intervals.values()]) fn()
    peakPerTick = Math.max(peakPerTick, fired.length - before)
  }
}

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
}

console.log('\n自动演奏引擎仿真')
console.log('─'.repeat(60))

/* ── 场景 1：全曲完整播放 ─────────────────────────────────────────────────── */
fired = []; firedIdx = []
pedalLog = []
auto.play()
// 按当前乐谱实际时长推进，再留 20s 收尾余量（曲子变长时不至于提前截断）
const theorySec = (score.spanBeats * 60) / 108
advance(theorySec + 20)

const uniqueIdx = new Set(firedIdx)
ok('全曲所有音都被调度（无遗漏）', uniqueIdx.size === score.notes.length, `${uniqueIdx.size} / ${score.notes.length}`)
ok('没有音被重复调度', firedIdx.length === uniqueIdx.size, `调用 ${firedIdx.length} 次`)
if (uniqueIdx.size !== score.notes.length) {
  const missing = []
  for (let i = 0; i < score.notes.length; i++) if (!uniqueIdx.has(i)) missing.push(i)
  console.log('     缺失音符 index：', missing.slice(0, 20).join(','), missing.length > 20 ? '…' : '')
  console.log('     对应：', missing.slice(0, 6).map((i) => `m${score.notes[i].measure} beat${score.notes[i].beat.toFixed(2)}`).join(' | '))
}
ok('发声声部数（含和弦内音）正确', fired.length === expected, `${fired.length} / ${expected}`)
ok('每个 tick 只调度少量音（前瞻调度，无一次性预调度）', peakPerTick > 0 && peakPerTick < 40,
  `峰值 ${peakPerTick} 音 / tick`)
const times = fired.map((f) => f.when)
let monotonic = true
for (let i = 1; i < times.length; i++) if (times[i] < times[i - 1] - 1e-9) { monotonic = false; break }
ok('发声时刻严格单调（写在音频时钟上）', monotonic)
const finishedAt = Math.max(...times)
ok('结束时刻 ≈ 乐谱时长', Math.abs(finishedAt - theorySec) < 2.5,
  `实际 ${finishedAt.toFixed(1)}s / 理论 ${theorySec.toFixed(1)}s`)
// down/up 必须交替出现（允许相邻同值去重后的严格交替），且曲终/停止后踏板必须抬起。
const uniqLog = []
for (const p of pedalLog) {
  const last = uniqLog[uniqLog.length - 1]
  if (!last || last.down !== p.down) uniqLog.push(p)
}
const downN = uniqLog.filter((p) => p.down).length
const upN = uniqLog.filter((p) => !p.down).length
ok('踏板 down/up 交替且最终抬起',
  uniqLog.length > 0 && downN === upN && uniqLog[uniqLog.length - 1].down === false,
  `${downN} 次踩下 / ${upN} 次抬起（原始 ${pedalLog.length} 次调用，去重后 ${uniqLog.length} 次切换）`)
const pedalDowns = downN
ok('踏板事件数量合理（不是每音一踩）', pedalDowns > 20 && pedalDowns < 200, `${pedalDowns} 段`)

/* ── 场景 2：暂停 / 继续 不丢音不重音 ─────────────────────────────────────── */
auto.stop()
fired = []; firedIdx = []
auto.play()
advance(30)
const beforePause = fired.length
auto.pause()
const heldBeat = auto.peek().currentBeat
advance(5) // 暂停期间不应有任何发声
const duringPause = fired.length - beforePause
ok('暂停期间不发声', duringPause === 0, `${duringPause} 个音`)
auto.resume()
advance(200)
// 暂停会撤销"已排进音频时钟、但尚未真正发声"的那几个音（否则暂停后它们会自己响出来），
// 恢复时这几个音会重新排一次 —— 因此允许极少量的重排，但绝不允许丢音。
const idxSet = new Set(firedIdx)
const replayed = firedIdx.length - idxSet.size
ok('继续后全曲仍然完整（不丢音）', idxSet.size === score.notes.length, `${idxSet.size} / ${score.notes.length}`)
ok('暂停/继续只重放前瞻窗口内的少量音', replayed > 0 && replayed <= 12, `重放 ${replayed} 个（前瞻窗口内）`)
ok('暂停点被记住', heldBeat > 0 && heldBeat < score.totalBeats, `beat=${heldBeat.toFixed(1)}`)

/* ── 场景 3：进度跳转 ─────────────────────────────────────────────────────── */
auto.stop()
fired = []; firedIdx = []
auto.play()
const midBeat = score.startBeat + score.spanBeats / 2
auto.seekBeat(midBeat)
advance(200)
const afterSeek = score.notes.filter((n) => n.beat >= midBeat).reduce((s, n) => s + n.midis.length, 0)
ok('跳转后只播放跳转点之后的音', fired.length >= afterSeek - 6 && fired.length <= afterSeek + 6,
  `${fired.length} ≈ ${afterSeek}`)

/* ── 场景 4：实时变速 ─────────────────────────────────────────────────────── */
auto.stop()
fired = []; firedIdx = []
auto.play()
advance(20)
const gapBefore = (() => {
  const t = fired.slice(-40).map((f) => f.when)
  const d = []
  for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) d.push(t[i] - t[i - 1])
  d.sort((a, b) => a - b)
  return d[Math.floor(d.length / 2)]
})()
auto.setBpm(160)
advance(20)
const gapAfter = (() => {
  const t = fired.slice(-40).map((f) => f.when)
  const d = []
  for (let i = 1; i < t.length; i++) if (t[i] > t[i - 1]) d.push(t[i] - t[i - 1])
  d.sort((a, b) => a - b)
  return d[Math.floor(d.length / 2)]
})()
ok('实时变速立即生效（音间隔按比例收缩）', gapAfter < gapBefore * 0.85,
  `${(gapBefore * 1000).toFixed(0)}ms → ${(gapAfter * 1000).toFixed(0)}ms（108→160 BPM）`)

/* ── 场景 5：重复播放的确定性 ─────────────────────────────────────────────── */
auto.stop()
fired = []; firedIdx = []
auto.play()
advance(15)
const runA = fired.length
auto.stop()
fired = []; firedIdx = []
auto.play()
advance(15)
const runB = fired.length
ok('同一速度下两次播放节奏一致', Math.abs(runA - runB) <= 2, `${runA} vs ${runB}`)

/* ── 场景 6：踏板共鸣（开启后应产生额外的共振音，且不与旋律音抢声部） ─────── */
auto.stop()
auto.applySettings({ resonance: true })
fired = []; firedIdx = []
auto.play()
advance(40)
const withRes = fired.length
const withResEnergy = fired.reduce((s, f) => s + (f.velocity ?? 0) ** 2, 0)
auto.stop()
auto.applySettings({ resonance: false })
fired = []; firedIdx = []
auto.play()
advance(40)
const noRes = fired.length
const noResEnergy = fired.reduce((s, f) => s + (f.velocity ?? 0) ** 2, 0)
// 用**能量**（力度平方和）而不是音个数来判定"有没有淹没旋律"：
// 共振音本来就该是极轻的装饰，个数多不等于声音响。
const resEnergy = withResEnergy - noResEnergy
ok('开启踏板共鸣后产生额外共振音', withRes > noRes, `${withRes} vs ${noRes}（+${withRes - noRes} 共振音）`)
ok('共振音能量远小于旋律（未淹没主线）',
  resEnergy > 0 && resEnergy < noResEnergy * 0.25,
  `共振音 ${withRes - noRes} 个（${(((withRes - noRes) / withRes) * 100).toFixed(0)}%），能量占比 ${((resEnergy / withResEnergy) * 100).toFixed(1)}%`)
auto.applySettings({ resonance: true })

auto.stop()

// 清理
for (const f of [entry, out]) { try { fs.unlinkSync(f) } catch { /* noop */ } }

console.log('─'.repeat(60))
console.log(`通过 ${pass} / ${pass + fail}\n`)
process.exit(fail ? 1 : 0)
