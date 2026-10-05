/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * diag-buffer.mjs — 直接检查解码/裁剪后的采样缓冲区内容
 *
 * 目的：单音包络出现过"衰减到很弱之后又回升到一个稳定电平"的异常，
 * 需要判断是「缓冲区本身如此」还是「播放链路上多出了一个声源」。
 * 这里把 C4 的裁剪后 buffer 与原始 mp3 解码结果并排画出来即可定性。
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

  const env = `(buf) => {
    const ch = buf.getChannelData(0)
    const rate = buf.sampleRate
    const seg = []
    for (let s = 0; s < buf.duration; s += 0.1) {
      let sum = 0, n = 0
      const a = Math.floor(s * rate), b = Math.min(ch.length, Math.floor((s + 0.1) * rate))
      for (let i = a; i < b; i++) { sum += ch[i] * ch[i]; n++ }
      seg.push(+(Math.sqrt(sum / Math.max(1, n))).toFixed(4))
    }
    return { duration: +buf.duration.toFixed(3), channels: buf.numberOfChannels, rate, seg }
  }`

  const res = await cdp.evaluate(`(async () => {
    const ps = window.__pianoStudio
    const se = ps.getAutoPlayEngine().samples
    const out = {}
    for (const key of ['C4v9', 'C4v3', 'A3v9']) {
      const d = se.samples.get(key)
      if (!d) { out[key] = { err: '未加载' }; continue }
      out[key] = (${env})(d.buffer)
    }
    // 原始 mp3（不裁剪）对照
    const ctx = ps.getAudioEngine().ctx
    const raw = await ctx.decodeAudioData(await (await fetch('samples/' + encodeURIComponent('C4v9.mp3'))).arrayBuffer())
    out['RAW C4v9'] = (${env})(raw)
    out._voices = se.voices ? se.voices.length : -1
    out._budget = JSON.stringify(se.stats())
    return out
  })()`)

  for (const [k, v] of Object.entries(res)) {
    if (k.startsWith('_')) continue
    if (v.err) { console.log(`${k}: ${v.err}`); continue }
    console.log(`\n${k}: duration=${v.duration}s ch=${v.channels} rate=${v.rate}`)
    console.log('  每0.1s RMS: ' + v.seg.slice(0, 90).join(' '))
  }
  console.log('\nvoices=', res._voices)
  console.log('stats=', res._budget)
  console.log('页面报错：', cdp.exceptions.length ? cdp.exceptions : '无')
} finally {
  cdp.close()
}
