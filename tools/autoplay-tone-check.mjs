/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * autoplay-tone-check.mjs — 在真实浏览器里播放《致爱丽丝》并**客观测量输出音频**
 *
 * 为什么不能只看"有没有报错"：音色的好坏是主观的，但"有没有削波、有没有漏音、
 * 高频是不是过量、升号音有没有真的加载到"这些是**可测量**的。
 * 本脚本在页面的最终输出节点（软限幅之后）挂一个 AnalyserNode 旁路监听，
 * 按 50ms 一帧采集时域与频域，最后给出量化结论。
 *
 * 用法：node tools/autoplay-tone-check.mjs [--seconds=24]
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, sleep, makeCounter } from './lib-cdp.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const URL_TARGET = process.argv.find((a) => a.startsWith('--url='))?.slice(6) || 'http://127.0.0.1:8791/#/autoplay'
const SECONDS = Number(process.argv.find((a) => a.startsWith('--seconds='))?.slice(10) || 24)

const { ok, pass, fail } = makeCounter()
const cdp = await connect({ url: URL_TARGET, root })

try {
  // ── 1. 等采样预热完成 ───────────────────────────────────────────────
  let ready = null
  for (let i = 0; i < 120; i++) {
    ready = await cdp.evaluate(`(() => {
      const ps = window.__pianoStudio
      if (!ps) return { stage: 'no-handle' }
      const eng = ps.getAutoPlayEngine()
      const s = eng.samples.stats()
      return { stage: 'ok', enabled: s.enabled, loaded: s.loaded, pending: s.pending, failed: s.failed, queued: s.queued, done: s.done, name: eng.samples.manifestName, keys: eng.samples.loadedKeys().length, coverage: eng.sampleCoverage() }
    })()`)
    if (ready.stage === 'ok' && ready.enabled && ready.pending === 0 && ready.loaded > 20) break
    await sleep(500)
  }

  console.log('\n=== 音源 ===')
  ok('采样清单已启用', !!ready?.enabled, ready?.name || '')
  ok('采样已解码 > 20 个', (ready?.loaded || 0) > 20, `loaded=${ready?.loaded} failed=${ready?.failed}`)
  ok('无加载失败', (ready?.failed || 0) === 0, `failed=${ready?.failed}`)
  ok('本曲音高覆盖 100%', (ready?.coverage || 0) > 0.999, `coverage=${((ready?.coverage || 0) * 100).toFixed(1)}%`)

  const keys = await cdp.evaluate(
    `window.__pianoStudio.getAutoPlayEngine().samples.loadedKeys().join(',')`,
  )
  const keyList = String(keys || '').split(',')
  ok('升号音确实加载（D#）', keyList.some((k) => k.startsWith('D#')), keyList.filter((k) => k.startsWith('D#')).slice(0, 4).join(' '))
  ok('升号音确实加载（F#）', keyList.some((k) => k.startsWith('F#')), keyList.filter((k) => k.startsWith('F#')).slice(0, 4).join(' '))

  // ── 2. 挂监听并开始播放 ────────────────────────────────────────────
  await cdp.evaluate(`(() => {
    const ps = window.__pianoStudio
    const ae = ps.getAudioEngine()
    const ctx = ae.ctx
    const an = ctx.createAnalyser()
    an.fftSize = 2048
    an.smoothingTimeConstant = 0.15
    ae.output.connect(an)
    const td = new Float32Array(an.fftSize)
    const fd = new Float32Array(an.frequencyBinCount)
    const acc = { frames: 0, silent: 0, peak: 0, sumSq: 0, clip: 0, low: 0, mid: 0, high: 0, hops: 0, n: 0, series: [] }
    let prev = 0
    const timer = setInterval(() => {
      an.getFloatTimeDomainData(td)
      let p = 0, s = 0
      for (let i = 0; i < td.length; i++) { const v = td[i]; const a = Math.abs(v); if (a > p) p = a; s += v * v }
      const rms = Math.sqrt(s / td.length)
      if (p > acc.peak) acc.peak = p
      acc.sumSq += s; acc.frames++; acc.n += td.length
      acc.series.push(+rms.toFixed(4))
      if (rms < 0.0012) acc.silent++
      if (p >= 0.9985) acc.clip++
      // 相邻帧能量跃变（用于发现"卡音/突跳"）
      if (prev > 0 && rms > prev * 6 && rms > 0.02) acc.hops++
      prev = rms
      an.getFloatFrequencyData(fd)
      const binHz = ctx.sampleRate / 2 / fd.length
      let lo = 0, mi = 0, hi = 0
      for (let i = 1; i < fd.length; i++) {
        const f = i * binHz
        const e = Math.pow(10, fd[i] / 10)
        if (f < 900) lo += e; else if (f < 4000) mi += e; else hi += e
      }
      acc.low += lo; acc.mid += mi; acc.high += hi
    }, 50)
    window.__tone = { acc, stop: () => clearInterval(timer) }
    // 真正的播放：先 stop 归零，再从曲首（含弱起）开始
    const eng = ps.getAutoPlayEngine()
    eng.seekProgress(0)
    eng.play()
    return true
  })()`)

  await sleep(SECONDS * 1000)
  const probe = await cdp.evaluate(`(() => { const t = window.__tone; const a = t.acc; t.stop(); return a })()`)

  const snap = await cdp.evaluate(`(() => {
    const eng = window.__pianoStudio.getAutoPlayEngine()
    const s = eng.peek()
    const st = eng.samples.stats()
    return { playing: s.playing, finished: s.finished, progress: s.progress, currentTime: s.currentTime, duration: s.duration, pedalDown: s.pedalDown, hits: st.hits, misses: st.misses, loaded: st.loaded, failed: st.failed }
  })()`)

  // ── 3. 客观指标 ────────────────────────────────────────────────────
  const rms = Math.sqrt(probe.sumSq / Math.max(1, probe.n))
  const silentRatio = probe.silent / Math.max(1, probe.frames)
  const totalE = probe.low + probe.mid + probe.high
  const hiRatio = totalE > 0 ? probe.high / totalE : 0

  /** 每 20 帧（约 1 秒）的平均 RMS 时间线，用来定位"哪几秒没有声音" */
  const perSec = []
  for (let i = 0; i < probe.series.length; i += 20) {
    const seg = probe.series.slice(i, i + 20)
    perSec.push(+(seg.reduce((a, b) => a + b, 0) / seg.length).toFixed(4))
  }

  console.log('\n=== 输出音频（软限幅之后取样）===')
  console.log(`  峰值 ${probe.peak.toFixed(4)} · RMS ${rms.toFixed(4)} · 静音帧 ${(silentRatio * 100).toFixed(1)}% · 满载帧 ${probe.clip} · 能量跃变 ${probe.hops}`)
  console.log(`  频段能量占比：<900Hz ${((probe.low / totalE) * 100).toFixed(1)}% · 0.9–4k ${((probe.mid / totalE) * 100).toFixed(1)}% · >4k ${(hiRatio * 100).toFixed(2)}%`)
  console.log(`  每秒平均 RMS：${perSec.join(' ')}`)
  console.log(`  进度 ${(snap.progress * 100).toFixed(1)}% · 已播 ${snap.currentTime.toFixed(1)}s / ${snap.duration.toFixed(1)}s · 采样命中 ${snap.hits} 未命中 ${snap.misses}`)

  ok('有实际音频输出', rms > 0.01, `rms=${rms.toFixed(4)}`)
  ok('未出现削波（满载帧为 0）', probe.clip === 0, `peak=${probe.peak.toFixed(4)}`)
  ok('峰值未冲过 1.0', probe.peak < 1.0, `peak=${probe.peak.toFixed(4)}`)
  ok('响度充足', rms > 0.03, `rms=${rms.toFixed(4)}`)
  ok('无大段漏音（静音帧 < 25%）', silentRatio < 0.25, `${(silentRatio * 100).toFixed(1)}%`)
  ok('采样命中率 > 98%', snap.hits / Math.max(1, snap.hits + snap.misses) > 0.98, `hits=${snap.hits} misses=${snap.misses}`)
  // 曲末 natural finish 后引擎会归零，此时进度断言无意义
  if (snap.finished) {
    ok('全曲演奏到自然结束', true, `总时长 ${snap.duration.toFixed(1)}s`)
  } else {
    ok('播放进度正常推进', snap.currentTime > SECONDS * 0.8, `${snap.currentTime.toFixed(1)}s`)
  }
  ok('高频不过量（>4k 占比 < 3%）', hiRatio < 0.03, `${(hiRatio * 100).toFixed(2)}%`)
  ok('无控制台报错', cdp.logs.length === 0, cdp.logs.slice(0, 3).join(' | '))
  ok('无未捕获异常', cdp.exceptions.length === 0, cdp.exceptions.slice(0, 2).join(' | '))

  console.log(`\n结果：${pass} 通过 / ${fail} 失败`)
  process.exitCode = fail === 0 ? 0 : 1
} finally {
  cdp.close()
}
