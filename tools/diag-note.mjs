/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * diag-note.mjs — 单音 / 和弦的发声包络诊断
 *
 * 用来回答一个具体问题："采样引擎触发一个音之后，它到底响了多久、多响？"
 * 挂在最终输出上按 50ms 采一次 RMS，画出包络，一眼就能看出是
 * 「采样被过早截断」「增益太小」还是「根本没发声」。
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect, sleep } from './lib-cdp.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const URL_TARGET = process.argv.find((a) => a.startsWith('--url='))?.slice(6) || 'http://127.0.0.1:8791/#/autoplay'

const cdp = await connect({ url: URL_TARGET, root })
try {
  for (let i = 0; i < 120; i++) {
    const s = await cdp.evaluate(`(() => { const ps = window.__pianoStudio; if (!ps) return null; const st = ps.getAutoPlayEngine().samples.stats(); return { enabled: st.enabled, pending: st.pending, loaded: st.loaded } })()`)
    if (s?.enabled && s.pending === 0 && s.loaded > 20) break
    await sleep(500)
  }

  const info = await cdp.evaluate(`(() => {
    const ps = window.__pianoStudio
    const ae = ps.getAudioEngine()
    const ctx = ae.ctx
    const an = ctx.createAnalyser()
    an.fftSize = 2048
    ae.output.connect(an)
    const sink = ctx.createGain(); sink.gain.value = 0; an.connect(sink); sink.connect(ctx.destination)
    window.__probe = { an, ctx, ae, ps }
    return { sampleRate: ctx.sampleRate, state: ctx.state, loaded: ps.getAutoPlayEngine().samples.loadedKeys().length }
  })()`)
  console.log('AudioContext:', JSON.stringify(info))

  /** 触发一组音并采集包络 */
  async function envelope(label, midis, velocity, duration, pedal, seconds) {
    await cdp.evaluate(`(() => {
      const { ae, ps, ctx } = window.__probe
      const eng = ps.getAutoPlayEngine()
      eng.stop()
      const se = eng.samples
      se.allNotesOff()
      se.setSustainPedal(${pedal})
      const t0 = ae.ctx.currentTime + 0.05
      const res = []
      const playList = ${JSON.stringify(midis)}
      playList.forEach((m) => {
        const ok = se.noteOn(m, ${velocity}, t0, ${duration}, ${pedal})
        res.push([m, ok])
      })
      window.__probe.res = res
      // 采集
      const td = new Float32Array(2048)
      const series = []
      const iv = setInterval(() => {
        window.__probe.an.getFloatTimeDomainData(td)
        let s = 0, p = 0
        for (let i = 0; i < td.length; i++) { const v = td[i]; s += v * v; const a = Math.abs(v); if (a > p) p = a }
        series.push([+Math.sqrt(s / td.length).toFixed(4), +p.toFixed(4)])
      }, 50)
      setTimeout(() => clearInterval(iv), ${seconds} * 1000)
      window.__probe.series = series
    })()`)
    await sleep(seconds * 1000 + 400)
    const out = await cdp.evaluate(`(() => ({ series: window.__probe.series, res: window.__probe.res, stats: window.__pianoStudio.getAutoPlayEngine().samples.stats() }))()`)
    const rmsSeries = out.series.map((x) => x[0])
    const peak = Math.max(...out.series.map((x) => x[1]))
    console.log(`\n${label}  midis=${midis.join(',')} vel=${velocity} dur=${duration}s pedal=${pedal}`)
    console.log(`  noteOn 返回：${JSON.stringify(out.res)}`)
    console.log(`  峰值 ${peak.toFixed(4)} · 命中 ${out.stats.hits} 未命中 ${out.stats.misses}`)
    console.log(`  包络(每50ms RMS)：${rmsSeries.join(' ')}`)
    return { rmsSeries, peak, out }
  }

  await envelope('① 单音 C4', [60], 0.7, 3, false, 4)
  await envelope('② 单音 C4（踏板）', [60], 0.7, 3, true, 6)
  await envelope('③ 和弦 A2-C4-E4-A4', [45, 60, 64, 69], 0.7, 3, true, 5)
  await envelope('④ 弱奏单音 C4', [60], 0.25, 3, false, 3)
  await envelope('⑤ 强奏单音 C4', [60], 0.95, 3, false, 3)

  console.log('\n页面报错：', cdp.exceptions.length ? cdp.exceptions : '无', cdp.logs.length ? cdp.logs : '')
} finally {
  cdp.close()
}
