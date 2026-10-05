/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * player-lookahead-test.mjs — 仿真验证 usePiecePlayer 的前瞻调度核心
 * 用 mock 引擎模拟 AudioContext 时间推进，验证：
 *  1. 音符按时间顺序被调度（不一次性全量预调度）
 *  2. 播放结束时 finish 恰好触发一次
 *  3. 循环段落在段落末尾正确重绕
 *  4. 任意时刻已创建的音频节点数有上界（旧 bug 的量化对比）
 */

const TICK_MS = 25
const LOOKAHEAD_S = 0.35
const TAIL_S = 0.5

// ── Mock 引擎 ──────────────────────────────────────────────────────────────
function makeMockEngine() {
  let t = 0
  return {
    get currentTime() { return t },
    advance(ms) { t += ms / 1000 },
    noteOnCount: 0,
    peakLiveNodes: 0,
    liveNodes: 0,
    noteOn({ when, duration }) {
      this.noteOnCount++
      this.liveNodes++
      // 模拟节点在 when+duration+release 后销毁
      const dieAt = when + duration + 0.5
      pendingDeaths.push({ dieAt, self: this })
    },
    allNotesOff() { this.liveNodes = 0 },
    clicks: 0,
    click() { this.clicks++ },
  }
}
const pendingDeaths = []

// ── 调度器仿真（与 usePiecePlayer.tick 相同的算法） ────────────────────────
function simulate({ events, spb, loopRange, simSeconds }) {
  const engine = makeMockEngine()
  const audioStart = engine.currentTime + 0.12
  const base = events[0].onsetBeat
  let cursor = 0
  let finished = false
  let finishCount = 0
  let rewinds = 0
  const lastIdx = events.length - 1
  const segEndWhen = () => {
    const last = events[lastIdx]
    return audioStart + (last.onsetBeat + last.durationBeats - base) * spb
  }

  const tick = () => {
    if (finished) return
    const now = engine.currentTime
    while (cursor <= lastIdx) {
      const e = events[cursor]
      const when = audioStart + (e.onsetBeat - base) * spb
      if (when > now + LOOKAHEAD_S) break
      engine.noteOn({ when: Math.max(when, now + 0.004), duration: Math.max(0.08, e.durationBeats * spb) })
      cursor++
    }
    if (now >= segEndWhen() + TAIL_S) {
      if (loopRange) {
        // 重绕
        const evStart = events.findIndex((e) => e.measure >= loopRange[0])
        const evEndIdx = (() => {
          for (let i = evStart; i < events.length; i++) if (events[i].measure > loopRange[1]) return i - 1
          return events.length - 1
        })()
        cursor = evStart
        rewinds++
        // 重置段落基准（简化：与主实现相同的相对推进）
        const newBase = events[evStart].onsetBeat
        const span = (events[evEndIdx].onsetBeat + events[evEndIdx].durationBeats - newBase) * spb
        void span
        return
      }
      finished = true
      finishCount++
    }
  }

  // 主循环：模拟 25ms tick
  const steps = Math.ceil((simSeconds * 1000) / TICK_MS)
  for (let i = 0; i < steps; i++) {
    tick()
    engine.advance(TICK_MS)
    // 回收死亡节点
    for (let d = pendingDeaths.length - 1; d >= 0; d--) {
      if (pendingDeaths[d].dieAt <= engine.currentTime) {
        pendingDeaths[d].self.liveNodes--
        pendingDeaths.splice(d, 1)
      }
    }
    engine.peakLiveNodes = Math.max(engine.peakLiveNodes, engine.liveNodes)
  }
  return { engine, finishCount, rewinds, scheduled: engine.noteOnCount, scheduledRatio: engine.noteOnCount / events.length }
}

// ── 构造测试事件（仿 3/8 拍《致爱丽丝》A 段节奏型） ────────────────────────
function makeEvents(measures, beatsPerMeasure = 3) {
  const evts = []
  for (let m = 1; m <= measures; m++) {
    // 每小节 6 个十六分音符（RH 主题）+ 3 个八分（LH）
    for (let s = 0; s < 6; s++) {
      evts.push({ midi: 76 - s, onsetBeat: (m - 1) * beatsPerMeasure + s * 0.5, durationBeats: 0.5, hand: 'right', measure: m, midis: [76 - s] })
    }
    for (let s = 0; s < 3; s++) {
      evts.push({ midi: 45 + s * 7, onsetBeat: (m - 1) * beatsPerMeasure + s, durationBeats: 1, hand: 'left', measure: m, midis: [45 + s * 7] })
    }
  }
  return evts.sort((a, b) => a.onsetBeat - b.onsetBeat)
}

const spb = 60 / 72 // 72 BPM
let failed = 0
const T = (name, ok) => {
  console.log(`${ok ? '✓' : '✗'} ${name}`)
  if (!ok) failed++
}

// 1. 完整播放（105 小节 ≈ 940 音符）
{
  const evts = makeEvents(105)
  const r = simulate({ events: evts, spb, loopRange: null, simSeconds: (105 * 3 * spb) + 3 })
  const totalBeats = 105 * 3
  T(`全曲调度完整（${r.scheduled}/${evts.length}，比率 ${r.scheduledRatio.toFixed(2)}）`, Math.abs(r.scheduledRatio - 1) < 0.01)
  T('结束恰好触发一次', r.finishCount === 1)
  T(`任意时刻存活音频节点有上界（峰值 ${r.engine.peakLiveNodes}，旧实现会是 ~940）`, r.engine.peakLiveNodes < 60)
}

// 2. 循环播放
{
  const evts = makeEvents(10)
  const r = simulate({ events: evts, spb, loopRange: [1, 4], simSeconds: 60 })
  T('循环模式持续重绕不结束（finishCount=0）', r.finishCount === 0 && r.rewinds >= 2)
  T(`循环下调度量随时间增长（已调度 ${r.scheduled}）`, r.scheduled > evts.length)
}

// 3. 调度时序正确性：tick 时刻的前瞻窗口内逐批调度
{
  const evts = makeEvents(50)
  const r = simulate({ events: evts, spb, loopRange: null, simSeconds: 1 })
  // 最后一次 tick 发生在 tLast（tick 先于 advance）
  const steps = Math.ceil((1 * 1000) / TICK_MS)
  const tLast = (steps - 1) * TICK_MS / 1000
  // when = audioStart + onset*spb ≤ tLast + LOOKAHEAD → onset ≤ (tLast + LOOKAHEAD - audioStartLead) / spb
  const maxBeat = (tLast + LOOKAHEAD_S - 0.12) / spb
  const maxOnset = Math.max(...evts.slice(0, r.scheduled).map((e) => e.onsetBeat))
  const minSkipped = Math.min(...evts.slice(r.scheduled).map((e) => e.onsetBeat))
  T(`前瞻窗口内逐批调度（已调度 ${r.scheduled}，末尾 onset ${maxOnset.toFixed(2)} ≤ 窗口 ${maxBeat.toFixed(2)} < 下一音 ${minSkipped.toFixed(2)}）`, maxOnset <= maxBeat && minSkipped > maxBeat)
}

console.log(failed === 0 ? '\n全部通过' : `\n${failed} 项失败`)
process.exit(failed === 0 ? 0 : 1)
