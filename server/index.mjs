/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * server/index.mjs — 零依赖同步服务端
 *
 * 设计目标：
 *  - 只用 Node 内置模块（http/fs/path/crypto），无需 npm install
 *  - 原子写入（写临时文件 + rename），断电/崩溃不会写坏数据
 *  - 同时提供静态文件服务（serve dist/），单进程即可部署
 *
 * API：
 *   POST /api/pair                    { pairCode, deviceId, create? }  → 注册/加入同步空间
 *   GET  /api/progress?pairCode=&deviceId=   → 拉取进度
 *   POST /api/progress                { pairCode, deviceId, progress } → 推送进度
 *   GET  /api/health                                              → 健康检查
 */

import http from 'node:http'
import fs from 'node:fs'
import fsp from 'node:fs/promises'
import path from 'node:path'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(__dirname, '..')
const DIST = path.join(ROOT, 'dist')
const DATA_DIR = path.join(__dirname, 'data')
const STORE_FILE = path.join(DATA_DIR, 'store.json')
const PORT = Number(process.env.PORT || 8791)
const HOST = process.env.HOST || '0.0.0.0'

// ── 存储 ────────────────────────────────────────────────────────────────────

/** 内存索引：pairCode → progress */
let store = { pairs: {}, updatedAt: 0 }

/** 写锁：避免并发写导致文件损坏 */
let writeChain = Promise.resolve()

async function loadStore() {
  try {
    const raw = await fsp.readFile(STORE_FILE, 'utf8')
    store = JSON.parse(raw)
    if (!store.pairs) store.pairs = {}
    console.log(`[store] 已加载 ${Object.keys(store.pairs).length} 个同步空间`)
  } catch (e) {
    if (e.code !== 'ENOENT') console.warn('[store] 读取失败，将使用空存储:', e.message)
    store = { pairs: {}, updatedAt: Date.now() }
    await ensureDataDir()
    await persist()
  }
}

async function ensureDataDir() {
  try {
    await fsp.mkdir(DATA_DIR, { recursive: true })
  } catch {
    /* 目录已存在 */
  }
}

/** 原子写：先写临时文件，再 rename（POSIX 与 NTFS 都是原子的） */
async function persist() {
  writeChain = writeChain.then(async () => {
    await ensureDataDir()
    const tmp = `${STORE_FILE}.${process.pid}.${Date.now()}.tmp`
    const payload = JSON.stringify({ ...store, updatedAt: Date.now() })
    await fsp.writeFile(tmp, payload, 'utf8')
    await fsp.rename(tmp, STORE_FILE)
  })
  return writeChain
}

// ── HTTP 工具 ───────────────────────────────────────────────────────────────

function sendJSON(res, status, data) {
  const body = JSON.stringify(data)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Cache-Control': 'no-store',
  })
  res.end(body)
}

function readBody(req, limitBytes = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limitBytes) {
        reject(new Error('请求体过大'))
        req.destroy()
        return
      }
      chunks.push(c)
    })
    req.on('end', () => {
      if (chunks.length === 0) return resolve({})
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (e) {
        reject(new Error('JSON 解析失败'))
      }
    })
    req.on('error', reject)
  })
}

const PAIR_RE = /^[2-9A-HJ-NP-Z]{4}-[2-9A-HJ-NP-Z]{4}$/

function normalizeCode(code) {
  const cleaned = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (cleaned.length !== 8) return null
  return `${cleaned.slice(0, 4)}-${cleaned.slice(4, 8)}`
}

// ── 进度合并（与服务端 ../src/core/progress.ts 保持一致） ──────────────────

function mergeProgress(local, remote) {
  const statusRank = { 'not-started': 0, learning: 1, passed: 2 }
  const lessons = { ...(remote.lessons || {}) }
  for (const [id, lp] of Object.entries(local.lessons || {})) {
    const rp = remote.lessons?.[id]
    if (!rp) { lessons[id] = lp; continue }
    lessons[id] = {
      lessonId: id,
      status: statusRank[lp.status] >= statusRank[rp.status] ? lp.status : rp.status,
      attempts: Math.max(lp.attempts, rp.attempts),
      lastPracticedAt: Math.max(lp.lastPracticedAt, rp.lastPracticedAt),
      quizAccuracy: Math.max(lp.quizAccuracy, rp.quizAccuracy),
    }
  }

  const sections = { ...(remote.sections || {}) }
  for (const [id, sp] of Object.entries(local.sections || {})) {
    const rp = remote.sections?.[id]
    if (!rp) { sections[id] = sp; continue }
    sections[id] = {
      sectionId: id,
      bestScore: Math.max(sp.bestScore, rp.bestScore),
      attempts: Math.max(sp.attempts, rp.attempts),
      mastered: sp.mastered || rp.mastered,
      lastPlayedAt: Math.max(sp.lastPlayedAt, rp.lastPlayedAt),
      measuresPracticed: [...new Set([...(rp.measuresPracticed || []), ...(sp.measuresPracticed || [])])].sort((a, b) => a - b),
    }
  }

  const byId = new Map()
  for (const s of [...(remote.sessions || []), ...(local.sessions || [])]) byId.set(s.id, s)
  const sessions = [...byId.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 200)

  return {
    revision: Math.max(local.revision || 0, remote.revision || 0) + 1,
    createdAt: Math.min(local.createdAt || Date.now(), remote.createdAt || Date.now()),
    updatedAt: Date.now(),
    totalPracticeSeconds: Math.max(local.totalPracticeSeconds || 0, remote.totalPracticeSeconds || 0),
    streakDays: Math.max(local.streakDays || 0, remote.streakDays || 0),
    lastPracticeDate: [local.lastPracticeDate, remote.lastPracticeDate].filter(Boolean).sort().pop() || null,
    lessons,
    sections,
    sessions,
    totalStars: Math.max(local.totalStars || 0, remote.totalStars || 0),
    profile: { ...(remote.profile || {}), ...(local.profile || {}) },
  }
}

// ── 静态文件 ────────────────────────────────────────────────────────────────

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
}

async function serveStatic(req, res, urlPath) {
  if (!fs.existsSync(DIST)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
    res.end(
      `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>Piano Studio</title>
      <style>body{background:#0b0d14;color:#e8eaf2;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;
      display:flex;align-items:center;justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px}
      code{background:#171a26;padding:6px 14px;border-radius:8px;color:#f0b429;font-size:15px}
      .box{max-width:520px;text-align:center;line-height:1.8}</style></head>
      <body><div class="box"><h1>🎹 Piano Studio</h1>
      <p>同步服务已启动，但还没有找到前端构建产物。</p>
      <p>请先执行 <code>npm run build</code> 生成 <code>dist/</code>。</p>
      <p>开发模式请另开终端运行 <code>npm run dev</code>。</p></div></body></html>`,
    )
    return
  }

  let rel = decodeURIComponent(urlPath)
  if (rel === '/' || rel === '') rel = '/index.html'
  // 防目录穿越
  const target = path.join(DIST, path.normalize(rel).replace(/^([/\\])+/, ''))
  if (!target.startsWith(DIST)) {
    res.writeHead(403).end('Forbidden')
    return
  }

  let filePath = target
  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    // SPA fallback
    filePath = path.join(DIST, 'index.html')
  }
  if (!fs.existsSync(filePath)) {
    res.writeHead(404).end('Not Found')
    return
  }

  const ext = path.extname(filePath).toLowerCase()
  const isHashed = /\/assets\//.test(filePath)
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': isHashed ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  fs.createReadStream(filePath).pipe(res)
}

// ── 请求处理 ────────────────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`)
  const pathname = url.pathname

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    })
    res.end()
    return
  }

  try {
    // ── 健康检查 ─────────────────────────────────────────────────────────
    if (pathname === '/api/health') {
      sendJSON(res, 200, {
        ok: true,
        service: 'piano-studio-sync',
        version: '1.0.0',
        pairs: Object.keys(store.pairs).length,
        uptimeSeconds: Math.round(process.uptime()),
        distExists: fs.existsSync(DIST),
      })
      return
    }

    // ── 配对 ─────────────────────────────────────────────────────────────
    if (pathname === '/api/pair' && req.method === 'POST') {
      const body = await readBody(req)
      const code = normalizeCode(body.pairCode)
      if (!code || !PAIR_RE.test(code)) {
        sendJSON(res, 400, { ok: false, message: '配对码格式不正确（应为 8 位字母数字，如 ABCD-2345）' })
        return
      }
      const deviceId = String(body.deviceId || crypto.randomUUID())

      if (!store.pairs[code]) {
        if (!body.create) {
          // 非创建模式下，允许「按需创建」——这样两端输入同一码就能汇合
          store.pairs[code] = {
            code,
            createdAt: Date.now(),
            devices: [deviceId],
            progress: null,
            revision: 0,
          }
          await persist()
          sendJSON(res, 200, { ok: true, created: true, message: '同步空间不存在，已自动创建' })
          return
        }
        store.pairs[code] = {
          code,
          createdAt: Date.now(),
          devices: [deviceId],
          progress: null,
          revision: 0,
        }
        await persist()
        sendJSON(res, 200, { ok: true, created: true, message: '同步空间已创建' })
        return
      }

      const p = store.pairs[code]
      if (!p.devices.includes(deviceId)) {
        p.devices.push(deviceId)
        await persist()
      }
      sendJSON(res, 200, { ok: true, created: false, message: '配对成功', deviceCount: p.devices.length })
      return
    }

    // ── 拉取进度 ─────────────────────────────────────────────────────────
    if (pathname === '/api/progress' && req.method === 'GET') {
      const code = normalizeCode(url.searchParams.get('pairCode'))
      if (!code || !store.pairs[code]) {
        sendJSON(res, 404, { progress: null, message: '同步空间不存在' })
        return
      }
      const deviceId = url.searchParams.get('deviceId')
      const p = store.pairs[code]
      if (deviceId && !p.devices.includes(deviceId)) {
        p.devices.push(deviceId)
        await persist()
      }
      sendJSON(res, 200, { progress: p.progress, revision: p.revision })
      return
    }

    // ── 推送进度 ─────────────────────────────────────────────────────────
    if (pathname === '/api/progress' && req.method === 'POST') {
      const body = await readBody(req)
      const code = normalizeCode(body.pairCode)
      if (!code) {
        sendJSON(res, 400, { ok: false, message: '配对码无效' })
        return
      }
      const incoming = body.progress
      if (!incoming || typeof incoming !== 'object') {
        sendJSON(res, 400, { ok: false, message: '缺少 progress 数据' })
        return
      }

      let p = store.pairs[code]
      if (!p) {
        p = { code, createdAt: Date.now(), devices: [], progress: null, revision: 0 }
        store.pairs[code] = p
      }
      const deviceId = String(body.deviceId || 'unknown')
      if (!p.devices.includes(deviceId)) p.devices.push(deviceId)

      // 服务端做合并，多设备同时推送不会互相覆盖
      p.progress = p.progress ? mergeProgress(incoming, p.progress) : { ...incoming, updatedAt: Date.now() }
      p.revision = p.progress.revision || p.revision + 1
      p.updatedAt = Date.now()
      await persist()

      sendJSON(res, 200, { ok: true, progress: p.progress, merged: true })
      return
    }

    // ── API 404 ──────────────────────────────────────────────────────────
    if (pathname.startsWith('/api/')) {
      sendJSON(res, 404, { ok: false, message: '接口不存在' })
      return
    }

    // ── 静态资源 ─────────────────────────────────────────────────────────
    await serveStatic(req, res, pathname)
  } catch (e) {
    console.error('[error]', e)
    if (!res.headersSent) sendJSON(res, 500, { ok: false, message: e.message || '服务器内部错误' })
    else res.end()
  }
})

await loadStore()

server.listen(PORT, HOST, () => {
  console.log('')
  console.log('  🎹  Piano Studio 同步服务已启动')
  console.log(`     监听   http://${HOST}:${PORT}`)
  console.log(`     静态   ${fs.existsSync(DIST) ? DIST : '(未构建 dist/)'}`)
  console.log(`     数据   ${STORE_FILE}`)
  console.log(`     空间数 ${Object.keys(store.pairs).length}`)
  console.log('')
})

// 优雅退出：确保待写入的数据落盘
async function shutdown(signal) {
  console.log(`\n[${signal}] 正在保存数据并退出…`)
  try {
    await writeChain
  } catch (e) {
    console.error('保存失败:', e.message)
  }
  server.close(() => process.exit(0))
  setTimeout(() => process.exit(0), 3000).unref()
}

process.on('SIGINT', () => shutdown('SIGINT'))
process.on('SIGTERM', () => shutdown('SIGTERM'))
process.on('uncaughtException', (e) => {
  console.error('[uncaught]', e)
})
