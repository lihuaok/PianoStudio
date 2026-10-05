/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/** 逐页巡检：确认音色链路改动没有影响其它页面 */
import { spawn } from 'node:child_process'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const BASE = process.argv[2] || 'http://127.0.0.1:8791'
const PORT = 9700 + Math.floor(Math.random() * 200)
const PROFILE = path.join(root, `_edgeprof_pages_${Date.now()}`)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const TASKKILL = 'C:/Windows/System32/taskkill.exe'
const killTree = (pid) => {
  try {
    // Git Bash 的 PATH 里没有 taskkill；且 spawn 失败会抛 unhandled 'error' 事件
    const c = spawn(TASKKILL, ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    c.on('error', () => { /* noop */ })
  } catch { /* noop */ }
}

const proc = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
  '--autoplay-policy=no-user-gesture-required',
  '--disable-background-timer-throttling',
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${PROFILE}`, 'about:blank',
], { stdio: 'ignore' })
process.on('exit', () => killTree(proc.pid))

let wsUrl = null
for (let i = 0; i < 60 && !wsUrl; i++) {
  try { wsUrl = (await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json()).webSocketDebuggerUrl } catch { await sleep(250) }
}
if (!wsUrl) { console.log('CDP 未就绪'); killTree(proc.pid); process.exit(1) }

const PAGES = [
  ['home', '#/', '.hero-title, .stat-grid'],
  ['curriculum', '#/curriculum', '.card'],
  ['theory', '#/theory', '.card'],
  ['repertoire', '#/repertoire', '.repertoire, .card'],
  ['autoplay', '#/autoplay', '.ap-page'],
  ['practice', '#/practice', '.practice-page, .card'],
  ['progress', '#/progress', '.card'],
  ['settings', '#/settings', '.card'],
]

const tgt = await (await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' })).json()
const ws = new WebSocket(tgt.webSocketDebuggerUrl)
await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })
let id = 0
const pend = new Map()
const errs = []
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pend.has(m.id)) { const p = pend.get(m.id); pend.delete(m.id); m.error ? p.rej(new Error(JSON.stringify(m.error))) : p.res(m.result); return }
  if (m.method === 'Runtime.exceptionThrown') errs.push(m.params.exceptionDetails.text + ' ' + (m.params.exceptionDetails.exception?.description ?? ''))
  if (m.method === 'Runtime.consoleAPICalled' && (m.params.type === 'error' || m.params.type === 'warning')) {
    errs.push('console.' + m.params.type + ': ' + m.params.args.map((a) => a.value ?? a.description ?? '').join(' '))
  }
}
const send = (method, params = {}) => new Promise((res, rej) => { const i = ++id; pend.set(i, { res, rej }); ws.send(JSON.stringify({ id: i, method, params })) })
const evaluate = async (e) => {
  const r = await send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true })
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text)
  return r.result.value
}
await send('Runtime.enable')
await send('Page.enable')

let pass = 0, fail = 0
for (const [name, hash, sel] of PAGES) {
  errs.length = 0
  await send('Page.navigate', { url: `${BASE}/index.html${hash}` })
  await sleep(3200)
  const info = await evaluate(`(() => {
    const root=document.querySelector('#root')||document.body
    return {
      nodes: root.querySelectorAll('*').length,
      hit: !!document.querySelector(${JSON.stringify(sel.split(',')[0].trim())}),
      cards: root.querySelectorAll('.card').length,
      text: (root.innerText||'').replace(/\\s+/g,' ').slice(0,60),
    }
  })()`)
  const okPage = info.nodes > 80 && info.text.length > 10 && errs.length === 0
  if (okPage) { pass++; console.log(`  ✓ ${name.padEnd(11)} 节点 ${String(info.nodes).padStart(5)} · 卡片 ${String(info.cards).padStart(3)} · ${info.text.slice(0, 34)}`) }
  else {
    fail++
    console.log(`  ✗ ${name.padEnd(11)} 节点 ${info.nodes} · ${info.text.slice(0, 40)}`)
    for (const e of errs.slice(0, 3)) console.log('      ' + e.slice(0, 160))
  }
}
console.log(`\n通过 ${pass} / ${pass + fail}`)
ws.close(); killTree(proc.pid)
await sleep(400)
try { fs.rmSync(PROFILE, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 }) } catch { /* noop */ }
process.exit(fail ? 1 : 0)
