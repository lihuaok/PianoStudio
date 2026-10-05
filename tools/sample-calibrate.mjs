/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * sample-calibrate.mjs — 采样层响度标定 + mp3 编码延迟体检
 *
 * 为什么必须标定：Salamander 的 v3 / v9 / v15 三层是三次独立录音，
 * 原始响度差好几个 dB。如果直接把三层接到同一条力度曲线上，中段会有明显的
 * "台阶"（弹到某个力度突然变响/变闷）。这里的做法是量出每层的实际 RMS，
 * 用层增益把它抵消掉，于是力度曲线可以全局共用一条 → 跨层听不出接缝。
 *
 * 同时输出每个采样的起音位置（lead）：mp3 解码后开头有 20~50ms 编码填充静音，
 * 必须跳过去，否则整曲"迟半个字"、起音发闷。
 *
 * 用法（需要 8791 服务已在跑）：node tools/sample-calibrate.mjs
 */

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { connect } from './lib-cdp.mjs'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const URL_BASE = process.argv.find((a) => a.startsWith('--url='))?.slice(6) || 'http://127.0.0.1:8791/'

const LAYERS = ['v3', 'v9', 'v15']
const ANCHORS = ['C2', 'D#2', 'F#2', 'A2', 'C3', 'D#3', 'F#3', 'A3', 'C4', 'D#4', 'F#4', 'A4', 'C5', 'D#5', 'F#5']

const probe = `(async () => {
  const LAYERS = ${JSON.stringify(LAYERS)}
  const ANCHORS = ${JSON.stringify(ANCHORS)}
  const ctx = new (window.AudioContext || window.webkitAudioContext)()
  const rows = []
  for (const L of LAYERS) {
    for (const a of ANCHORS) {
      try {
        const r = await fetch('samples/' + encodeURIComponent(a + L + '.mp3'))
        if (!r.ok) { rows.push({ layer: L, note: a, err: 'HTTP ' + r.status }); continue }
        const buf = await ctx.decodeAudioData(await r.arrayBuffer())
        const rate = buf.sampleRate
        const n = buf.length
        const chs = []
        for (let c = 0; c < Math.min(2, buf.numberOfChannels); c++) chs.push(buf.getChannelData(c))
        const at = (i) => { let v = 0; for (const d of chs) v += Math.abs(d[i]); return v / chs.length }
        let lead = 0
        const lim = Math.min(n, Math.floor(rate * 0.35))
        for (let i = 0; i < lim; i++) if (at(i) > 0.0025) { lead = Math.max(0, (i - Math.floor(rate * 0.004)) / rate); break }
        let endIdx = n - 1
        for (let i = n - 1; i > rate * 0.1; i--) if (at(i) > 0.0012) { endIdx = Math.min(n - 1, i + Math.floor(rate * 0.01)); break }
        const s0 = Math.floor(lead * rate)
        const s1 = Math.min(endIdx, s0 + Math.floor(rate * 1.2))
        let sum = 0, cnt = 0
        for (let i = s0; i < s1; i++) { const v = at(i); sum += v * v; cnt++ }
        const rms = cnt > 0 ? Math.sqrt(sum / cnt) : 0
        let peak = 0
        for (let i = s0; i < s1; i++) { const v = at(i); if (v > peak) peak = v }
        rows.push({ layer: L, note: a, channels: buf.numberOfChannels, rate, dur: +(buf.duration).toFixed(2), lead: +lead.toFixed(4), end: +endIdx / rate, rms: +rms.toFixed(5), peak: +peak.toFixed(4) })
      } catch (e) { rows.push({ layer: L, note: a, err: String(e && e.message || e) }) }
    }
  }
  return rows
})()`

const cdp = await connect({ url: URL_BASE, root })
try {
  // 等页面就绪（只要有 window 即可，采样用相对路径 fetch）
  await cdp.evaluate('document.readyState')
  const rows = await cdp.evaluate(probe)
  const bad = rows.filter((r) => r.err)
  if (bad.length) {
    console.log('解码失败：')
    for (const b of bad.slice(0, 10)) console.log('  ', b.note, b.layer, b.err)
  }

  const good = rows.filter((r) => !r.err)
  const byLayer = {}
  for (const L of LAYERS) {
    const list = good.filter((r) => r.layer === L)
    const rms = list.map((r) => r.rms).sort((a, b) => a - b)
    const med = rms.length ? rms[Math.floor(rms.length / 2)] : 0
    byLayer[L] = { n: list.length, medianRms: +med.toFixed(5), avgLead: +(list.reduce((s, r) => s + r.lead, 0) / Math.max(1, list.length)).toFixed(4) }
  }

  const ref = byLayer['v9']?.medianRms || 1
  const gain = {}
  for (const L of LAYERS) gain[L] = +Math.min(4, Math.max(0.3, ref / (byLayer[L].medianRms || ref))).toFixed(3)

  console.log('\n=== 每层统计（中位数 RMS / 平均起音偏移）===')
  for (const L of LAYERS) {
    console.log(`  ${L}: n=${byLayer[L].n}  medianRms=${byLayer[L].medianRms}  avgLead=${byLayer[L].avgLead}s  → gain=${gain[L]}`)
  }
  console.log('\n=== 通道数与时长抽样 ===')
  for (const r of good.filter((_, i) => i % 7 === 0).slice(0, 8)) {
    console.log(`  ${r.note}${r.layer}: ch=${r.channels} dur=${r.dur}s lead=${r.lead}s peak=${r.peak}`)
  }
  console.log('\n建议 manifest layers.gain =', JSON.stringify([gain['v3'], gain['v9'], gain['v15']]))
  console.log('页面报错：', cdp.exceptions.length ? cdp.exceptions : '无')
} finally {
  cdp.close()
}
