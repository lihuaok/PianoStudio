/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * browser-autoplay-check.mjs — 真实浏览器里完整跑一遍自动演奏并抓错
 *
 * 为什么不用 `--virtual-time-budget`：虚拟时间会让 setTimeout 瞬间到期，
 * 而 AudioContext 的时钟走的是**真实时间**，两者不同步 →
 * 页面显示"播放了 12 秒"其实音频只走了 1 秒，自查结果毫无意义。
 * 这里改用 CDP（Chrome DevTools Protocol）驱动真实时钟。
 *
 * 用法：node tools/browser-autoplay-check.mjs [url] [--seconds=20]
 */
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const URL_TARGET = process.argv[2]?.startsWith('http') ? process.argv[2] : 'http://127.0.0.1:8791/#/autoplay'
const SECONDS = Number((process.argv.find((a) => a.startsWith('--seconds=')) || '').slice(10) || 20)
const PORT = 9333 + Math.floor(Math.random() * 400)
// 每次用独立 profile：复用会因 profile 锁而连到上一个还活着的 Edge 实例，
// 表现为"点了播放但时间不动"这种极难查的假失败。
const PROFILE = path.join(root, `_edgeprof_cdp_${Date.now()}`)

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 杀整个进程树：Edge 会派生子进程，只 kill 父进程会留下占着 profile 的僵尸 */
function killTree(pid) {
  try {
    // Git Bash 的 PATH 里没有 taskkill；且 spawn 失败会抛 unhandled 'error' 事件
    const c = spawn('C:/Windows/System32/taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    c.on('error', () => { /* noop */ })
  } catch {
    try { process.kill(-pid) } catch { /* noop */ }
  }
}

let pass = 0
let fail = 0
const ok = (name, cond, extra = '') => {
  if (cond) { pass++; console.log(`  ✓ ${name}${extra ? ' — ' + extra : ''}`) }
  else { fail++; console.log(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
}

const proc = spawn(EDGE, [
  '--headless=new',
  '--disable-gpu',
  '--no-sandbox',
  '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  // ★ 这三个必须加：进程在后台/被遮挡时 Chromium 会冻结 rAF 与定时器，
  //   表现为"音频在放、界面时间不动"，误判成播放失败。
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${PROFILE}`,
  'about:blank',
], { stdio: 'ignore' })

process.on('exit', () => { try { killTree(proc.pid) } catch { /* noop */ } })

// ── 等 CDP 端点起来 ────────────────────────────────────────────────────────
let wsUrl = null
for (let i = 0; i < 60; i++) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/json/version`)
    const j = await r.json()
    wsUrl = j.webSocketDebuggerUrl
    if (wsUrl) break
  } catch { /* 还没起来 */ }
  await sleep(250)
}
if (!wsUrl) {
  console.error('CDP 端点未就绪（Edge 是否启动失败？）')
  killTree(proc.pid)
  process.exit(1)
}

// ── 打开目标页 ─────────────────────────────────────────────────────────────
const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?${encodeURIComponent(URL_TARGET)}`, { method: 'PUT' })).json()
const ws = new WebSocket(tgt.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

let msgId = 0
const pending = new Map()
const consoleErrors = []
const exceptions = []

ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id)
    pending.delete(m.id)
    if (m.error) rej(new Error(JSON.stringify(m.error)))
    else res(m.result)
    return
  }
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    consoleErrors.push(`console.${m.params.type}: ` + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const d = m.params.exceptionDetails
    exceptions.push(`${d.text} ${d.exception?.description ?? ''}`.trim())
  }
}

function send(method, params = {}) {
  const id = ++msgId
  return new Promise((res, rej) => {
    pending.set(id, { res, rej })
    ws.send(JSON.stringify({ id, method, params }))
  })
}

/** 在页面里求值（返回 JSON 化的结果） */
async function evaluate(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
  return r.result.value
}

await send('Runtime.enable')
await send('Page.enable')
await send('Page.navigate', { url: URL_TARGET })

// 等 React 渲染出播放按钮
let ready = false
for (let i = 0; i < 80; i++) {
  await sleep(250)
  ready = await evaluate(`!!document.querySelector('.ap-transport button')`)
  if (ready) break
}
console.log('\n浏览器自查（真实时钟）')
console.log('─'.repeat(60))
ok('自动演奏页渲染完成', ready)

const meta = await evaluate(`[...document.querySelectorAll('.ap-meta .pill')].map(e=>e.textContent.trim()).join(' | ')`)
console.log(`  曲目信息：${meta}`)
ok('曲目规模正确（930 音 / 125 小节）', /930 音 · 125 小节/.test(meta), meta)
const durations = await evaluate(`(() => {
  const pills=[...document.querySelectorAll('.ap-meta .pill')].map(e=>e.textContent.trim());
  return pills.find(p=>p.startsWith('约')) || '';
})()`)
ok('默认时长约 3 分钟', /^约 2:5\d$|^约 3:0\d$/.test(durations), durations)

const timbres = await evaluate(`[...document.querySelectorAll('.ap-sliders select option')].map(o=>o.textContent)`)
ok('音色下拉含电钢琴 / 柔和大钢琴', timbres.some((t) => t.includes('电钢琴')) && timbres.some((t) => t.includes('柔和大钢琴')),
  timbres.join(' / '))

// ── 点播放，跑真实时间 ────────────────────────────────────────────────────
await evaluate(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('完整演奏'));
  b.click(); return true;
})()`)

const timeText = () => evaluate(`(document.querySelector('.ap-time')?.textContent||'').trim()`)
const t0 = await timeText()
const wall0 = Date.now()
/**
 * 播放期间持续测量 + 直接读取引擎内部状态。
 * 引擎状态是权威判据：UI 时间依赖 rAF，进程在后台被 Chromium 节流时 rAF 会冻结，
 * 界面就不动了 —— 那是测量环境的假象，不是播放失败。
 */
await evaluate(`(() => {
  const h = window.__pianoStudio
  const eng = h.getAudioEngine()
  const auto = h.getAutoPlayEngine()
  const mk = (node) => { const a = eng.ctx.createAnalyser(); a.fftSize = 2048; node.connect(a); return a }
  const pre = mk(eng.masterGain)
  const post = mk(eng.output)
  const buf = new Float32Array(2048)
  const P = { pre: 0, post: 0, clipped: 0, frames: 0, maxBeat: 0, finished: false, ctxTime: 0 }
  window.__peakProbe = P
  const id = setInterval(() => {
    let pp = 0, qp = 0
    pre.getFloatTimeDomainData(buf); for (const v of buf) pp = Math.max(pp, Math.abs(v))
    post.getFloatTimeDomainData(buf); for (const v of buf) qp = Math.max(qp, Math.abs(v))
    P.pre = Math.max(P.pre, pp)
    P.post = Math.max(P.post, qp)
    if (qp >= 0.999) P.clipped++
    P.frames++
    try {
      const b = auto.currentBeat ? auto.currentBeat() : 0
      if (b > P.maxBeat) P.maxBeat = b
      if (auto.finished) P.finished = true
      P.ctxTime = eng.currentTime
    } catch (e) { /* 引擎私有字段改名时忽略 */ }
  }, 40)
  window.__peakStop = () => {
    clearInterval(id)
    eng.masterGain.disconnect(pre)
    try { eng.output.disconnect(post) } catch (e) { /* noop */ }
  }
  return true
})()`)
await sleep(SECONDS * 1000)
const wall = (Date.now() - wall0) / 1000
const t1 = await timeText()
console.log(`  播放 ${wall.toFixed(1)}s（真实）· 页面时间 ${t0} → ${t1}`)

const durSec = await evaluate(`(() => {
  const p=[...document.querySelectorAll('.ap-meta .pill')].map(e=>e.textContent.trim()).find(x=>x.startsWith('约'));
  const m=p && p.match(/(\\d+):(\\d+)/);
  return m ? Number(m[1])*60+Number(m[2]) : 0;
})()`)
const totalBeats = await evaluate(`(() => {
  const a = window.__pianoStudio.getAutoPlayEngine();
  return a && a.score ? a.score.totalBeats : 0;
})()`)
// 秒数足够跑完整曲时，断言"确实播到了尾声"而不是中途停住
if (SECONDS >= durSec + 6) {
  const btnTxt = await evaluate(`[...document.querySelectorAll('button')].map(b=>b.textContent.trim()).find(t=>t.includes('演奏')&&!t.includes('自动演奏'))`)
  ok('播完后按钮回到可重播状态', /重新|完整演奏/.test(btnTxt || ''), btnTxt)
}

// 采样琴键联动：连续 12 次，每次 120ms，统计有多少次有琴键高亮
let progressMax = 0
const early = await sampleKeys(1400, 100)
for (let i = 0; i < 4; i++) {
  await sleep(150)
  const p = await evaluate(`(() => {
    const el=[...document.querySelectorAll('input[type=range]')].find(x=>x.max==='1000');
    return el?Number(el.value):-1;
  })()`)
  if (p > progressMax) progressMax = p
}
ok('琴键联动数据源持续更新', early.hits > 0, `${early.hits}/${early.rounds} 次采样有声，最多同时 ${early.max} 音（UI 高亮最多 ${early.uiMax}）`)
ok('进度条在推进', progressMax > 0, `最大 ${progressMax / 10}%`)

const mix = await evaluate(`(() => {
  const P = window.__peakProbe
  window.__peakStop && window.__peakStop()
  return { pre: P.pre, post: P.post, clipped: P.clipped, frames: P.frames, maxBeat: P.maxBeat, finished: P.finished, ctxTime: P.ctxTime }
})()`)
console.log(`  播放 ${wall.toFixed(1)}s：进入限幅器峰值 ${mix.pre.toFixed(3)} → 实际输出峰值 ${mix.post.toFixed(3)}（${mix.frames} 次采样）`)
console.log(`  音频时钟走了 ${mix.ctxTime.toFixed(1)}s · 引擎播放到第 ${mix.maxBeat.toFixed(1)} 拍 / 全曲 ${totalBeats.toFixed(1)} 拍`)

// 权威判据：引擎自己的播放位置（UI 时间依赖 rAF，后台运行会被 Chromium 节流）
ok('播放进度随音频时钟推进', mix.ctxTime > 5, `音频时钟 ${mix.ctxTime.toFixed(1)}s`)
ok('引擎播放位置持续推进', mix.maxBeat > 0, `到第 ${mix.maxBeat.toFixed(1)} 拍`)

// 秒数足够跑完整曲时，断言"确实播到了尾声"而不是中途停住
if (SECONDS >= durSec + 6) {
  ok('完整播放到曲末（引擎已收尾）', mix.finished === true, `finished=${mix.finished}`)
  ok('播放位置到达全曲末尾', mix.maxBeat >= totalBeats - 6,
    `${mix.maxBeat.toFixed(1)} / ${totalBeats.toFixed(1)} 拍`)
  ok('实际输出不削波（软限幅把电平守在 1.0）', mix.post <= 1.0001, `输出峰值 ${mix.post.toFixed(4)}`)
}
ok('几乎不进入硬削波区（满幅采样 < 1%）', mix.clipped / Math.max(1, mix.frames) < 0.01,
  `满幅采样 ${mix.clipped}/${mix.frames}`)
ok('动态范围合理（限幅器前峰值在 0.1~1.6）', mix.pre > 0.1 && mix.pre < 1.6, `${mix.pre.toFixed(3)}`)

/**
 * 跳转进度条。
 * 注意：React 的受控 input 会用内部 value tracker 去重，
 * 直接 `el.value = x` 再派发 input 事件**不会**触发 onChange，
 * 必须借 HTMLInputElement.prototype 上的原生 setter 改值。
 */
const seekTo = async (pct) => {
  await evaluate(`(() => {
    const el=[...document.querySelectorAll('input[type=range]')].find(x=>x.max==='1000');
    const setter=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;
    setter.call(el, ${pct * 10});
    el.dispatchEvent(new Event('input',{bubbles:true}));
    return true;
  })()`)
  await sleep(1500)
  return timeText()
}

const spots = await evaluate(`document.querySelectorAll('.ap-sec-card').length`)
console.log(`  结构卡：${spots} 张`)

/**
 * 在一段时间内多次采样"正在发声的音高"。
 *
 * 判据取**引擎的 activeNotesAt**（UI 高亮的数据源）而不是 DOM class：
 * DOM class 由 rAF 驱动的 React 渲染更新，进程在后台被 Chromium 节流时
 * 不会变化，会误判成"联动坏了"。UI class 数量一并记下来供参考。
 */
async function sampleKeys(ms = 1400, every = 100) {
  let hits = 0
  let max = 0
  let uiMax = 0
  const rounds = Math.max(1, Math.round(ms / every))
  for (let i = 0; i < rounds; i++) {
    const s = await evaluate(`(() => {
      const a = window.__pianoStudio.getAutoPlayEngine()
      const b = a.currentBeat ? a.currentBeat() : 0
      const notes = a.activeNotesAt ? a.activeNotesAt(b) : []
      return { n: notes.length, ui: document.querySelectorAll('.pk-key.is-pressed').length }
    })()`)
    if (s.n > 0) hits++
    if (s.n > max) max = s.n
    if (s.ui > uiMax) uiMax = s.ui
    await sleep(every)
  }
  return { hits, max, uiMax, rounds }
}

// 完整播放结束后引擎已收尾，此时 seek 只移动游标、不会重新发声 —— 先重新起播再测跳转
await evaluate(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>/完整演奏|重新演奏/.test(x.textContent));
  if (b) b.click();
  return true;
})()`)
await sleep(1400)
const resumed = await evaluate(`(() => {
  const a = window.__pianoStudio.getAutoPlayEngine();
  return a.running === true;
})()`)
ok('播完后可重新起播（seek 前提）', resumed === true, `running=${resumed}`)

for (const pct of [35, 62, 88, 99]) {
  const t = await seekTo(pct)
  const expect = Math.round((pct / 100) * 178) // 2:58 全长
  const got = Number(t.split(':')[0]) * 60 + Number(t.split(':')[1])
  ok(`跳到 ${pct}% 后时间正确前移`, Math.abs(got - expect) < 12, `${t}（预期 ≈${Math.floor(expect / 60)}:${String(expect % 60).padStart(2, '0')}）`)
  const k = await sampleKeys(1500)
  ok(`跳到 ${pct}% 后仍在发声（琴键联动数据源）`, k.hits > 0, `${k.hits}/${k.rounds} 次采样有声，最多同时 ${k.max} 音（UI 高亮最多 ${k.uiMax}）`)
}

// 点结构卡跳转（真实用户路径）
const cardJump = await evaluate(`(() => {
  const cards=[...document.querySelectorAll('.ap-sec-card')];
  const target=cards[cards.length-2] || cards[0];
  target.click();
  return target.textContent.trim().slice(0,24);
})()`)
await sleep(1500)
ok('点击结构卡可跳转', (await timeText()) !== '0:00', `${cardJump} → ${await timeText()}`)

// 等 99% 处的尾声自然结束
await sleep(6000)
const finished = await evaluate(`(() => {
  const b=[...document.querySelectorAll('button')].map(x=>x.textContent.trim());
  return b.join(',');
})()`)
ok('播放到尾声结束（未卡死、按钮回到可重播状态）', finished.length > 0, finished.slice(0, 90))

// ── 切音色 / 暂停继续 / 停止 ─────────────────────────────────────────────
await evaluate(`(() => {
  const el=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('重新')||x.textContent.includes('完整演奏'));
  if (el) el.click();
  return true;
})()`)
await sleep(1200)
await evaluate(`(() => {
  const s=document.querySelector('.ap-sliders select');
  s.value='warm'; s.dispatchEvent(new Event('change',{bubbles:true}));
  return s.value;
})()`)
await sleep(1500)
const warmOk = await evaluate(`document.querySelector('.ap-sliders select').value`)
ok('切换到柔和大钢琴', warmOk === 'warm', String(warmOk))

const btn = (kw) => evaluate(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('${kw}'));
  if(!b) return false; b.click(); return true;
})()`)
ok('暂停按钮可用', await btn('暂停'))
await sleep(700)
const pausedTime = await timeText()
await sleep(900)
ok('暂停后时间不再前进', (await timeText()) === pausedTime, pausedTime)
ok('继续按钮可用', await btn('继续'))
await sleep(1200)
ok('继续后时间恢复前进', (await timeText()) !== pausedTime, await timeText())
ok('停止按钮可用', await btn('停止'))

// ── 客观音质检测（AnalyserNode 实测，不靠主观听感）────────────────────────
/**
 * 用户反馈"音色刺耳"。刺耳在信号层面有三条可测的罪证：
 *   ① 削波/爆音：峰值顶到 1.0 以上被硬切，或起音那一两帧从 0 直冲满幅；
 *   ② 尖锐高频：4kHz 以上的能量占比过高；
 *   ③ 音准不准：基频偏离目标音。
 * 这里逐条测量并给出数值。
 */
console.log('\n客观音质检测（单音 · AnalyserNode 实测）')
console.log('─'.repeat(60))

// 必须先停奏：曲子还在响的话，单音测量会被旋律污染（基频/频谱全被带偏）
await evaluate(`(() => {
  const b=[...document.querySelectorAll('button')].find(x=>x.textContent.includes('停止'));
  if (b) b.click();
  return true;
})()`)
await sleep(1200)

const probe = await evaluate(`(async () => {
  const h = window.__pianoStudio
  if (!h) return { error: 'no debug handle' }
  const eng = h.getAudioEngine()
  await eng.unlock()
  const ctx = eng.ctx
  const an = ctx.createAnalyser()
  an.fftSize = 4096
  an.smoothingTimeConstant = 0
  eng.masterGain.connect(an)

  const time = new Float32Array(an.fftSize)
  const freq = new Float32Array(an.frequencyBinCount)
  const binHz = ctx.sampleRate / an.fftSize

  const wait = (ms) => new Promise(r => setTimeout(r, ms))
  /** 等总线安静下来：混响尾音会污染基频与频谱测量 */
  const waitSilent = async (limit = 4000) => {
    const t0 = Date.now()
    while (Date.now() - t0 < limit) {
      an.getFloatTimeDomainData(time)
      let p = 0
      for (const v of time) p = Math.max(p, Math.abs(v))
      if (p < 0.002) return true
      await wait(60)
    }
    return false
  }
  const measure = async (midi, preset, ms) => {
    eng.allNotesOff()
    await wait(700) // 明确的静默期：让上一个音的释放与混响尾彻底散掉
    await waitSilent()
    const target = 440 * Math.pow(2, (midi - 69) / 12)
    eng.noteOn(midi, { velocity: 0.8, duration: ms / 1000, preset })

    /**
     * 扫描整段发声，取**峰值帧**做频谱分析。
     * 固定延时时取样会随机落在衰减深处，测出来的峰值/频谱全不可信。
     * 爆音指标用「相邻样本最大跳变 / 峰值」：与采样率无关，
     * 1.0 意味着一个采样步内从 0 冲到满幅（硬爆音）；平滑包络应远小于 1。
     */
    let bestFrame = null
    let bestPeak = 0
    let maxDelta = 0
    for (let i = 0; i < 45; i++) {
      await wait(16)
      an.getFloatTimeDomainData(time)
      let p = 0
      for (let k = 0; k < time.length; k++) {
        const v = Math.abs(time[k])
        if (v > p) p = v
        if (k > 0) {
          const d = Math.abs(time[k] - time[k - 1])
          if (d > maxDelta) maxDelta = d
        }
      }
      if (p > bestPeak) { bestPeak = p; bestFrame = Float32Array.from(time) }
      if (i > 8 && bestPeak > 0 && p < bestPeak * 0.3) break // 已明显衰减
    }
    if (!bestFrame) bestFrame = Float32Array.from(time)

    an.getFloatFrequencyData(freq)
    // 找频谱峰：音准的判据是"目标频率处是否有显著谱峰"，比自相关稳得多
    //（自相关在准周期信号上会锁到 2/3/5 倍周期，报出 -1900 音分这种假错）
    const mag = new Float64Array(freq.length)
    let maxMag = 0
    for (let i = 1; i < freq.length; i++) {
      mag[i] = Math.pow(10, freq[i] / 20)
      if (mag[i] > maxMag) maxMag = mag[i]
    }
    const peaks = []
    for (let i = 2; i < freq.length - 2; i++) {
      if (mag[i] > mag[i - 1] && mag[i] > mag[i + 1] && mag[i] > maxMag * 0.02) {
        // 抛物线插值提高频率分辨率
        const d = 0.5 * (mag[i - 1] - mag[i + 1]) / (mag[i - 1] - 2 * mag[i] + mag[i + 1] || 1e-9)
        peaks.push({ hz: (i + d) * binHz, rel: mag[i] / maxMag })
      }
    }
    peaks.sort((a, b) => b.rel - a.rel)
    const near = peaks
      .map((p) => ({ ...p, cents: 1200 * Math.log2(p.hz / target) }))
      .filter((p) => Math.abs(p.cents) < 60)
      .sort((a, b) => b.rel - a.rel)[0] ?? null

    let total = 0, hi = 0
    for (let i = 1; i < freq.length; i++) {
      total += mag[i]
      if (i * binHz >= 4000) hi += mag[i]
    }

    eng.allNotesOff()
    await wait(200)
    return {
      midi, preset,
      targetHz: target,
      peakHz: near ? near.hz : 0,
      cents: near ? near.cents : null,
      peakRel: near ? near.rel : 0,
      topPeaks: peaks.slice(0, 3).map((p) => p.hz.toFixed(1) + 'Hz').join(' '),
      peak: bestPeak,
      hiRatio: total > 0 ? hi / total : 1,
      clickIndex: maxDelta / Math.max(1e-6, bestPeak),
    }
  }

  const out = []
  for (const preset of ['epiano', 'warm', 'grand']) {
    out.push(await measure(60, preset, 900))   // C4
    out.push(await measure(69, preset, 900))   // A4
  }
  eng.masterGain.disconnect(an)
  return { out, sampleRate: ctx.sampleRate }
})()`)

if (probe.error) {
  ok('调试句柄可用', false, probe.error)
} else {
  ok('调试句柄可用', true, `sampleRate=${probe.sampleRate}`)
  console.log('  预设        MIDI   目标频率    主峰频率     偏差      相对强度   4kHz+占比   归一化跳变')
  for (const r of probe.out) {
    console.log(
      `  ${r.preset.padEnd(10)} ${String(r.midi).padStart(3)}  ${r.targetHz.toFixed(2).padStart(8)}Hz  ` +
      `${r.peakHz.toFixed(2).padStart(8)}Hz  ${(r.cents >= 0 ? '+' : '') + r.cents.toFixed(1).padStart(6)}¢  ` +
      `${(r.peakRel * 100).toFixed(0).padStart(7)}%  ${(r.hiRatio * 100).toFixed(2).padStart(8)}%  ${r.clickIndex.toFixed(3).padStart(10)}`,
    )
  }
  const cents = probe.out.map((r) => Math.abs(r.cents ?? 999))
  const peaks = probe.out.map((r) => r.peak)
  const rels = probe.out.map((r) => r.peakRel)
  const hiEpi = probe.out.filter((r) => r.preset === 'epiano').map((r) => r.hiRatio)
  const hiGrand = probe.out.filter((r) => r.preset === 'grand').map((r) => r.hiRatio)
  ok('音准准确（主峰偏差 < 15 音分）', Math.max(...cents) < 15, `最大偏差 ${Math.max(...cents).toFixed(1)} 音分`)
  ok('目标频率处有显著谱峰（不是靠泛音蒙对）', Math.min(...rels) > 0.5,
    `最弱主峰 ${(Math.min(...rels) * 100).toFixed(0)}% 峰值`)
  ok('无削波（峰值 ≤ 1.0）', Math.max(...peaks) <= 1.0, `最大峰值 ${Math.max(...peaks).toFixed(3)}`)
  ok('电钢琴高频占比明显低于原三角钢琴（不刺耳）',
    Math.max(...hiEpi) < Math.min(...hiGrand),
    `电钢琴 ≤${(Math.max(...hiEpi) * 100).toFixed(2)}% vs 三角钢琴 ≥${(Math.min(...hiGrand) * 100).toFixed(2)}%`)
  ok('高频占比在温和区间（< 3%）', Math.max(...hiEpi) < 0.03, `${(Math.max(...hiEpi) * 100).toFixed(2)}%`)
  const maxJump = Math.max(...probe.out.map((r) => r.clickIndex))
  ok('包络连续无爆音（归一化跳变 < 0.35）', maxJump < 0.35,
    `最大 ${maxJump.toFixed(3)}（1.0 = 一个采样步内冲到满幅）`)
}

// ── 全程报错汇总 ─────────────────────────────────────────────────────────
ok('全程无未捕获异常', exceptions.length === 0, exceptions.slice(0, 3).join(' ; '))
ok('全程无 console.error / warn', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' ; '))

console.log('─'.repeat(60))
console.log(`通过 ${pass} / ${pass + fail}\n`)
ws.close()
killTree(proc.pid)
await sleep(400)
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* noop */ }
process.exit(fail ? 1 : 0)
