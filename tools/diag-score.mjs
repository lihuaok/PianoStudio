/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * diag-score.mjs — 「应该弹多少音」与「实际弹了多少音」的对照诊断
 *
 * 这是判断"演奏是否完整"的唯一硬办法：不能靠听，要靠计数。
 *  · 期望值：按当前速度，前 N 秒内乐谱上应触发的音符个数（从 score 直接推）
 *  · 实测值：引擎真正调用采样引擎发声的次数（hits）
 *  · 同时输出力度分布与同时在响的声部数，判断响度为何偏低
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, sleep } from './lib-cdp.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const URL_TARGET = process.argv.find((a) => a.startsWith('--url='))?.slice(6) || 'http://127.0.0.1:8791/#/autoplay'
const SECONDS = Number(process.argv.find((a) => a.startsWith('--seconds='))?.slice(10) || 16)

const cdp = await connect({ url: URL_TARGET, root })
try {
  for (let i = 0; i < 120; i++) {
    const s = await cdp.evaluate(`(() => { const ps = window.__pianoStudio; if (!ps) return null; const st = ps.getAutoPlayEngine().samples.stats(); return { enabled: st.enabled, pending: st.pending, loaded: st.loaded } })()`)
    if (s?.enabled && s.pending === 0 && s.loaded > 20) break
    await sleep(500)
  }

  const scoreInfo = await cdp.evaluate(`(() => {
    const eng = window.__pianoStudio.getAutoPlayEngine()
    const sc = eng.score
    const notes = sc.notes
    const spb = 60 / eng.getBpm()
    const velocities = notes.map((n) => n.velocity)
    const midiCount = notes.reduce((s, n) => s + n.midis.length, 0)
    const bins = {}
    for (const v of velocities) { const b = (Math.round(v * 10) / 10).toFixed(1); bins[b] = (bins[b] || 0) + 1 }
    const allMidi = notes.flatMap((n) => n.midis)
    // 每秒音符密度（按实际节奏）
    const bySecond = []
    for (let s = 0; s < 30; s++) {
      const lo = sc.startBeat + s / spb
      const hi = sc.startBeat + (s + 1) / spb
      bySecond.push(notes.filter((n) => n.beat >= lo && n.beat < hi).length)
    }
    return {
      notes: notes.length,
      midiCount,
      startBeat: sc.startBeat,
      spanBeats: sc.spanBeats,
      spb: +spb.toFixed(4),
      velMin: +Math.min(...velocities).toFixed(3),
      velMax: +Math.max(...velocities).toFixed(3),
      velAvg: +(velocities.reduce((a, b) => a + b, 0) / velocities.length).toFixed(3),
      bins,
      midiMin: Math.min(...allMidi),
      midiMax: Math.max(...allMidi),
      pedals: sc.pedals.length,
      bySecond,
    }
  })()`)

  console.log('=== 乐谱 ===')
  console.log(`  音符 ${scoreInfo.notes} 个 / 发声 ${scoreInfo.midiCount} 个（含和弦展开）`)
  console.log(`  音域 MIDI ${scoreInfo.midiMin}–${scoreInfo.midiMax} · 起点拍 ${scoreInfo.startBeat} · 总拍 ${scoreInfo.spanBeats} · 每拍 ${scoreInfo.spb}s`)
  console.log(`  力度 min ${scoreInfo.velMin} / avg ${scoreInfo.velAvg} / max ${scoreInfo.velMax}`)
  console.log(`  力度分布 ${JSON.stringify(scoreInfo.bins)}`)
  console.log(`  前 30 秒每秒音符数 ${scoreInfo.bySecond.join(' ')}`)

  // 开始播放并跟踪声部数
  await cdp.evaluate(`(() => {
    const eng = window.__pianoStudio.getAutoPlayEngine()
    const se = eng.samples
    window.__voiceLog = []
    window.__vt = setInterval(() => { window.__voiceLog.push(se.voices.length) }, 100)
    eng.seekProgress(0)
    eng.play()
    return true
  })()`)

  await sleep(SECONDS * 1000)
  const after = await cdp.evaluate(`(() => {
    const eng = window.__pianoStudio.getAutoPlayEngine()
    clearInterval(window.__vt)
    const st = eng.samples.stats()
    const snap = eng.peek()
    const sc = eng.score
    const spb = 60 / eng.getBpm()
    const reachBeat = sc.startBeat + snap.currentTime / spb
    const expected = sc.notes.filter((n) => n.beat <= reachBeat)
    const expectedMidis = expected.reduce((s, n) => s + n.midis.length, 0)
    const vl = window.__voiceLog
    return {
      hits: st.hits, misses: st.misses, expectedMidis,
      reachedBeat: +reachBeat.toFixed(2),
      currentTime: +snap.currentTime.toFixed(2),
      playing: snap.playing, pedalDown: snap.pedalDown,
      voiceMax: Math.max(...vl), voiceAvg: +(vl.reduce((a, b) => a + b, 0) / vl.length).toFixed(2),
      voiceSeries: vl.filter((_, i) => i % 10 === 0).slice(0, 40),
      gainInfo: (() => { const ae = window.__pianoStudio.getAudioEngine(); return { master: ae.masterGain.gain.value } })(),
    }
  })()`)

  console.log('\n=== 播放对照 ===')
  console.log(`  已播 ${after.currentTime}s（到达第 ${after.reachedBeat} 拍）· playing=${after.playing} pedal=${after.pedalDown}`)
  console.log(`  应发声 ${after.expectedMidis} 个 · 实际 hits ${after.hits} · misses ${after.misses}`)
  console.log(`  覆盖率 ${((after.hits / Math.max(1, after.expectedMidis)) * 100).toFixed(1)}%`)
  console.log(`  同时在响声部：峰值 ${after.voiceMax} · 平均 ${after.voiceAvg}`)
  console.log(`  声部数序列(每1s)：${after.voiceSeries.join(' ')}`)
  console.log(`  masterGain=${after.gainInfo.master}`)
  console.log('页面报错：', cdp.exceptions.length ? cdp.exceptions : '无')
} finally {
  cdp.close()
}
