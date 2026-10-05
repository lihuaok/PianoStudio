/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * lib-cdp.mjs — 无头 Edge + CDP 的最小可用封装（供 tools 下的自查脚本复用）
 *
 * 两个必须注意的坑（都踩过）：
 *  ① **每次用独立 profile**：复用 profile 会因锁而连到上一个还活着的 Edge 实例，
 *     表现为"点了播放但时间不动"这种极难查的假失败。
 *  ② **关闭后台节流**：进程在后台/被遮挡时 Chromium 会冻结 rAF 与定时器，
 *     音频在响但界面不动，同样会被误判成失败。
 */

import { spawn } from 'node:child_process'
import path from 'node:path'

export const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** 杀整个进程树：Edge 会派生子进程，只 kill 父进程会留下占着 profile 的僵尸 */
export function killTree(pid) {
  try {
    const c = spawn('C:/Windows/System32/taskkill.exe', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' })
    c.on('error', () => {})
  } catch {
    try { process.kill(-pid) } catch { /* noop */ }
  }
}

/**
 * 启动一个无头 Edge 并连到 CDP。
 * @returns {{ send, evaluate, logs, exceptions, close, port }}
 */
export async function connect({ url = 'about:blank', root = process.cwd(), port } = {}) {
  const P = port ?? 9333 + Math.floor(Math.random() * 400)
  const PROFILE = path.join(root, `_edgeprof_${Date.now()}_${Math.floor(Math.random() * 1000)}`)

  const proc = spawn(EDGE, [
    '--headless=new',
    '--disable-gpu',
    '--no-sandbox',
    '--mute-audio',
    '--autoplay-policy=no-user-gesture-required',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    `--remote-debugging-port=${P}`,
    `--user-data-dir=${PROFILE}`,
    'about:blank',
  ], { stdio: 'ignore' })

  const close = () => { try { killTree(proc.pid) } catch { /* noop */ } }
  process.on('exit', close)

  let wsUrl = null
  for (let i = 0; i < 60; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${P}/json/version`)).json()
      wsUrl = j.webSocketDebuggerUrl
      if (wsUrl) break
    } catch { /* 还没起来 */ }
    await sleep(250)
  }
  if (!wsUrl) {
    close()
    throw new Error('CDP 端点未就绪（Edge 是否启动失败？）')
  }

  const tgt = await (await fetch(`http://127.0.0.1:${P}/json/new?${encodeURIComponent(url)}`, { method: 'PUT' })).json()
  const ws = new WebSocket(tgt.webSocketDebuggerUrl)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej })

  let msgId = 0
  const pending = new Map()
  const logs = []
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
    if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
      logs.push('console.error: ' + m.params.args.map((a) => a.value ?? a.description ?? a.type).join(' '))
    }
    if (m.method === 'Runtime.exceptionThrown') {
      const d = m.params.exceptionDetails
      exceptions.push(`${d.text} ${d.exception?.description ?? ''}`.trim())
    }
  }

  const send = (method, params = {}) => {
    const id = ++msgId
    return new Promise((res, rej) => {
      pending.set(id, { res, rej })
      ws.send(JSON.stringify({ id, method, params }))
    })
  }

  /** 在页面里求值（自动 await Promise，返回结构化结果） */
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
    if (r.exceptionDetails) {
      throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''))
    }
    return r.result.value
  }

  return { send, evaluate, logs, exceptions, close, port: P }
}

/** 断言计数器 */
export function makeCounter() {
  let pass = 0
  let fail = 0
  const rows = []
  const ok = (name, cond, extra = '') => {
    if (cond) { pass++; rows.push(`  ✓ ${name}${extra ? ' — ' + extra : ''}`) }
    else { fail++; rows.push(`  ✗ ${name}${extra ? ' — ' + extra : ''}`) }
    console.log(rows[rows.length - 1])
    return !!cond
  }
  return { ok, get pass() { return pass }, get fail() { return fail }, rows }
}
