/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * progress.ts — 学习进度追踪 + 跨设备同步
 *
 * 设计原则：**离线优先（offline-first）**
 *  1. 任何写入先落本地（localStorage），界面立刻响应，永不因网络阻塞。
 *  2. 后台异步同步到服务端；离线时静默失败并排队。
 *  3. 用「设备配对码」实现跨设备关联，无需账号注册。
 *  4. 每次变更递增 revision，服务端按 revision 裁决（后写胜出），并保留
 *     简单的合并策略：不同设备的练习记录取并集，最高分取最大值。
 */

const STORAGE_KEY = 'piano-studio:progress:v1'
const DEVICE_KEY = 'piano-studio:device-id'
const PAIR_KEY = 'piano-studio:pair-code'
const QUEUE_KEY = 'piano-studio:sync-queue'

// ── 数据模型 ────────────────────────────────────────────────────────────────

export interface PracticeSession {
  id: string
  /** 曲目/章节 id */
  targetId: string
  targetName: string
  /** 开始时间戳 */
  startedAt: number
  /** 练习时长（秒） */
  durationSeconds: number
  /** 评分（0-100），未评分则 null */
  score: number | null
  /** 手部 */
  hand: 'right' | 'left' | 'both'
  /** BPM */
  bpm: number
  /** 评分细分 */
  breakdown?: {
    pitch: number
    rhythm: number
    dynamics: number
    fluency: number
    fingering: number
  }
  deviceId: string
}

export interface LessonProgress {
  lessonId: string
  status: 'not-started' | 'learning' | 'passed'
  /** 练习次数 */
  attempts: number
  lastPracticedAt: number
  /** 答题正确率 */
  quizAccuracy: number
}

export interface SectionProgress {
  sectionId: string
  bestScore: number
  attempts: number
  /** 是否已完整通过（≥85 分） */
  mastered: boolean
  lastPlayedAt: number
  /** 已练习的小节 */
  measuresPracticed: number[]
}

export interface UserProgress {
  revision: number
  createdAt: number
  updatedAt: number
  /** 累计练习时长（秒） */
  totalPracticeSeconds: number
  /** 连续学习天数 */
  streakDays: number
  lastPracticeDate: string | null
  /** 完成的课程 */
  lessons: Record<string, LessonProgress>
  /** 曲目章节进度 */
  sections: Record<string, SectionProgress>
  /** 练习记录（最多保留最近 200 条） */
  sessions: PracticeSession[]
  /** 累计获得的星数 */
  totalStars: number
  /** 用户档案 */
  profile: {
    displayName: string
    level: number
    dailyGoalMinutes: number
    /** 输入设备偏好 */
    preferredInput: 'onScreen' | 'computer' | 'midi' | 'mic'
  }
}

export function emptyProgress(): UserProgress {
  return {
    revision: 0,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    totalPracticeSeconds: 0,
    streakDays: 0,
    lastPracticeDate: null,
    lessons: {},
    sections: {},
    sessions: [],
    totalStars: 0,
    profile: {
      displayName: '琴友',
      level: 1,
      dailyGoalMinutes: 30,
      preferredInput: 'onScreen',
    },
  }
}

// ── 设备与配对 ──────────────────────────────────────────────────────────────

export function getDeviceId(): string {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = `dev_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function getPairCode(): string | null {
  return localStorage.getItem(PAIR_KEY)
}

export function setPairCode(code: string | null) {
  if (code) localStorage.setItem(PAIR_KEY, code)
  else localStorage.removeItem(PAIR_KEY)
}

/** 生成人类友好的配对码（去掉易混淆字符 0/O/1/I） */
export function generatePairCode(): string {
  const alphabet = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'
  let code = ''
  for (let i = 0; i < 8; i++) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)]
    if (i === 3) code += '-'
  }
  return code
}

// ── 本地存储 ────────────────────────────────────────────────────────────────

export function loadProgress(): UserProgress {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return emptyProgress()
    const parsed = JSON.parse(raw) as UserProgress
    // 与默认值合并，兼容旧版本数据
    const base = emptyProgress()
    return {
      ...base,
      ...parsed,
      profile: { ...base.profile, ...(parsed.profile ?? {}) },
      lessons: parsed.lessons ?? {},
      sections: parsed.sections ?? {},
      sessions: parsed.sessions ?? [],
    }
  } catch {
    return emptyProgress()
  }
}

export function saveProgress(p: UserProgress): void {
  p.updatedAt = Date.now()
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
  } catch (e) {
    // 配额超限：丢弃最旧的 session 后重试
    if (p.sessions.length > 20) {
      p.sessions = p.sessions.slice(0, 20)
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(p))
      } catch {
        /* 放弃持久化，内存状态仍可用 */
      }
    }
  }
  markDirty()
}

// ── 同步队列 ────────────────────────────────────────────────────────────────

let dirty = false
let syncTimer: number | null = null
const listeners = new Set<(state: SyncState) => void>()

export interface SyncState {
  status: 'idle' | 'syncing' | 'synced' | 'offline' | 'error' | 'unpaired'
  lastSyncedAt: number | null
  paired: boolean
  message: string
}

let syncState: SyncState = {
  status: 'idle',
  lastSyncedAt: null,
  paired: !!getPairCode(),
  message: '',
}

export function getSyncState(): SyncState {
  return syncState
}

export function onSyncState(fn: (s: SyncState) => void): () => void {
  listeners.add(fn)
  return () => listeners.delete(fn)
}

function emit() {
  for (const l of listeners) l(syncState)
}

function markDirty() {
  dirty = true
  const code = getPairCode()
  if (!code) {
    syncState = { ...syncState, status: 'unpaired', message: '未配对，进度仅保存在本机' }
    emit()
    return
  }
  // 防抖：2 秒内的多次修改合并为一次推送
  if (syncTimer !== null) clearTimeout(syncTimer)
  syncTimer = window.setTimeout(() => {
    void pushToServer()
  }, 2000)
}

async function api(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  })
}

/** 推送到服务端 */
export async function pushToServer(): Promise<boolean> {
  const code = getPairCode()
  if (!code) {
    syncState = { ...syncState, status: 'unpaired', message: '未配对，进度仅保存在本机' }
    emit()
    return false
  }
  if (!navigator.onLine) {
    syncState = { ...syncState, status: 'offline', message: '离线中，恢复网络后自动同步' }
    emit()
    return false
  }

  syncState = { ...syncState, status: 'syncing', message: '正在同步…' }
  emit()

  try {
    const progress = loadProgress()
    const res = await api('/api/progress', {
      method: 'POST',
      body: JSON.stringify({ pairCode: code, deviceId: getDeviceId(), progress }),
    })
    if (!res.ok) throw new Error(`服务端返回 ${res.status}`)
    const data = (await res.json()) as { progress: UserProgress; merged?: boolean }
    if (data.progress) {
      const merged = mergeProgress(loadProgress(), data.progress)
      saveProgress(merged)
    }
    dirty = false
    localStorage.removeItem(QUEUE_KEY)
    syncState = {
      status: 'synced',
      lastSyncedAt: Date.now(),
      paired: true,
      message: '已同步',
    }
    emit()
    return true
  } catch (e) {
    syncState = {
      ...syncState,
      status: navigator.onLine ? 'error' : 'offline',
      message: navigator.onLine ? `同步失败：${e instanceof Error ? e.message : e}` : '离线中，已排队',
    }
    emit()
    return false
  }
}

/** 配对：在服务端注册或加入一个配对空间 */
export async function pairWith(code: string): Promise<{ ok: boolean; message: string }> {
  try {
    const res = await api('/api/pair', {
      method: 'POST',
      body: JSON.stringify({ pairCode: code.trim().toUpperCase(), deviceId: getDeviceId() }),
    })
    const data = (await res.json()) as { ok?: boolean; message?: string; created?: boolean }
    if (res.ok && data.ok !== false) {
      setPairCode(code.trim().toUpperCase())
      syncState = { ...syncState, paired: true, status: 'idle', message: '配对成功' }
      emit()
      await pullFromServer()
      return { ok: true, message: data.created ? '已创建新的同步空间' : '配对成功，正在拉取云端进度' }
    }
    return { ok: false, message: data.message ?? '配对失败' }
  } catch (e) {
    return { ok: false, message: `网络错误：${e instanceof Error ? e.message : e}` }
  }
}

/** 创建新的同步空间 */
export async function createPairSpace(): Promise<{ ok: boolean; code?: string; message: string }> {
  const code = generatePairCode()
  try {
    const res = await api('/api/pair', {
      method: 'POST',
      body: JSON.stringify({ pairCode: code, deviceId: getDeviceId(), create: true }),
    })
    if (!res.ok) throw new Error(`服务端返回 ${res.status}`)
    setPairCode(code)
    syncState = { ...syncState, paired: true, status: 'idle', message: '同步空间已创建' }
    emit()
    return { ok: true, code, message: '同步空间已创建，请在其它设备输入该配对码' }
  } catch (e) {
    return { ok: false, message: `创建失败：${e instanceof Error ? e.message : e}` }
  }
}

export async function pullFromServer(): Promise<boolean> {
  const code = getPairCode()
  if (!code) return false
  try {
    const res = await api(`/api/progress?pairCode=${encodeURIComponent(code)}&deviceId=${encodeURIComponent(getDeviceId())}`)
    if (!res.ok) return false
    const data = (await res.json()) as { progress: UserProgress | null }
    if (!data.progress) {
      // 云端还没有数据 → 推送本机数据上去
      await pushToServer()
      return true
    }
    const merged = mergeProgress(loadProgress(), data.progress)
    saveProgress(merged)
    syncState = { ...syncState, status: 'synced', lastSyncedAt: Date.now(), message: '已从云端拉取' }
    emit()
    return true
  } catch {
    syncState = { ...syncState, status: 'offline', message: '拉取失败，稍后重试' }
    emit()
    return false
  }
}

export function unpair() {
  setPairCode(null)
  syncState = { ...syncState, paired: false, status: 'idle', message: '已解除配对' }
  emit()
}

/**
 * 进度合并策略（跨设备）
 *  - revision：取较大者 + 1
 *  - lessons / sections：逐字段取「更优」（练习次数多者、分数高者）
 *  - sessions：按 id 去重后按时间排序，保留最近 200 条
 *  - totalPracticeSeconds：取较大值（而不是相加，避免重复上传导致膨胀）
 *  - streakDays / totalStars：取较大值
 */
export function mergeProgress(local: UserProgress, remote: UserProgress): UserProgress {
  const base: UserProgress = {
    ...emptyProgress(),
    ...local,
    profile: { ...local.profile },
  }

  // 课程进度
  const lessons: Record<string, LessonProgress> = { ...remote.lessons }
  for (const [id, lp] of Object.entries(local.lessons)) {
    const rp = remote.lessons[id]
    if (!rp) {
      lessons[id] = lp
      continue
    }
    const statusRank = { 'not-started': 0, learning: 1, passed: 2 } as const
    lessons[id] = {
      lessonId: id,
      status: statusRank[lp.status] >= statusRank[rp.status] ? lp.status : rp.status,
      attempts: Math.max(lp.attempts, rp.attempts),
      lastPracticedAt: Math.max(lp.lastPracticedAt, rp.lastPracticedAt),
      quizAccuracy: Math.max(lp.quizAccuracy, rp.quizAccuracy),
    }
  }

  // 章节进度
  const sections: Record<string, SectionProgress> = { ...remote.sections }
  for (const [id, sp] of Object.entries(local.sections)) {
    const rp = remote.sections[id]
    if (!rp) {
      sections[id] = sp
      continue
    }
    sections[id] = {
      sectionId: id,
      bestScore: Math.max(sp.bestScore, rp.bestScore),
      attempts: Math.max(sp.attempts, rp.attempts),
      mastered: sp.mastered || rp.mastered,
      lastPlayedAt: Math.max(sp.lastPlayedAt, rp.lastPlayedAt),
      measuresPracticed: [...new Set([...(rp.measuresPracticed ?? []), ...(sp.measuresPracticed ?? [])])].sort((a, b) => a - b),
    }
  }

  // 练习记录去重合并
  const byId = new Map<string, PracticeSession>()
  for (const s of [...remote.sessions, ...local.sessions]) byId.set(s.id, s)
  const sessions = [...byId.values()].sort((a, b) => b.startedAt - a.startedAt).slice(0, 200)

  // 连续天数：取较大的 lastPracticeDate 对应的 streak
  const streakDays = pickStreak(local, remote)

  return {
    revision: Math.max(local.revision, remote.revision) + 1,
    createdAt: Math.min(local.createdAt, remote.createdAt),
    updatedAt: Date.now(),
    totalPracticeSeconds: Math.max(local.totalPracticeSeconds, remote.totalPracticeSeconds),
    streakDays,
    lastPracticeDate: pickLatestDate(local, remote),
    lessons,
    sections,
    sessions,
    totalStars: Math.max(local.totalStars, remote.totalStars),
    profile: { ...remote.profile, ...local.profile },
  }
}

function pickStreak(a: UserProgress, b: UserProgress): number {
  const newer = (a.lastPracticeDate ?? '') >= (b.lastPracticeDate ?? '') ? a : b
  return Math.max(a.streakDays, b.streakDays) === newer.streakDays ? newer.streakDays : Math.max(a.streakDays, b.streakDays)
}

function pickLatestDate(a: UserProgress, b: UserProgress): string | null {
  if (!a.lastPracticeDate) return b.lastPracticeDate
  if (!b.lastPracticeDate) return a.lastPracticeDate
  return a.lastPracticeDate >= b.lastPracticeDate ? a.lastPracticeDate : b.lastPracticeDate
}

// ── 进度操作 ────────────────────────────────────────────────────────────────

export function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function recordSession(session: PracticeSession): UserProgress {
  const p = loadProgress()
  const key = todayKey()
  const yesterday = (() => {
    const d = new Date()
    d.setDate(d.getDate() - 1)
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  })()

  if (p.lastPracticeDate !== key) {
    p.streakDays = p.lastPracticeDate === yesterday ? p.streakDays + 1 : 1
    p.lastPracticeDate = key
  }

  p.totalPracticeSeconds += session.durationSeconds
  p.sessions = [session, ...p.sessions].slice(0, 200)
  p.revision += 1

  // 章节进度
  const sec = p.sections[session.targetId] ?? {
    sectionId: session.targetId,
    bestScore: 0,
    attempts: 0,
    mastered: false,
    lastPlayedAt: 0,
    measuresPracticed: [],
  }
  sec.attempts += 1
  sec.lastPlayedAt = Date.now()
  if (session.score !== null) {
    if (session.score > sec.bestScore) {
      const oldStars = Math.floor((sec.bestScore / 100) * 5)
      const newStars = Math.floor((session.score / 100) * 5)
      if (newStars > oldStars) p.totalStars += newStars - oldStars
      sec.bestScore = session.score
    }
    if (session.score >= 85) sec.mastered = true
  }
  p.sections[session.targetId] = sec

  saveProgress(p)
  return p
}

export function recordLesson(lessonId: string, correct: boolean): UserProgress {
  const p = loadProgress()
  const lp = p.lessons[lessonId] ?? {
    lessonId,
    status: 'not-started' as const,
    attempts: 0,
    lastPracticedAt: 0,
    quizAccuracy: 0,
  }
  lp.attempts += 1
  lp.lastPracticedAt = Date.now()
  const totalQ = lp.attempts
  lp.quizAccuracy = correct ? (lp.quizAccuracy * (totalQ - 1) + 1) / totalQ : (lp.quizAccuracy * (totalQ - 1)) / totalQ
  lp.status = correct ? 'passed' : lp.status === 'not-started' ? 'learning' : lp.status
  p.lessons[lessonId] = lp
  saveProgress(p)
  return p
}

export function updateProfile(patch: Partial<UserProgress['profile']>): UserProgress {
  const p = loadProgress()
  p.profile = { ...p.profile, ...patch }
  saveProgress(p)
  return p
}

/** 今日练习时长（秒） */
export function todayPracticeSeconds(p: UserProgress): number {
  const key = todayKey()
  return p.sessions
    .filter((s) => {
      const d = new Date(s.startedAt)
      const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      return k === key
    })
    .reduce((a, s) => a + s.durationSeconds, 0)
}

/** 练习热力图（最近 N 天） */
export function practiceHeatmap(p: UserProgress, days = 91): Array<{ date: string; seconds: number }> {
  const map = new Map<string, number>()
  for (const s of p.sessions) {
    const d = new Date(s.startedAt)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    map.set(k, (map.get(k) ?? 0) + s.durationSeconds)
  }
  const out: Array<{ date: string; seconds: number }> = []
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date()
    d.setDate(d.getDate() - i)
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    out.push({ date: k, seconds: map.get(k) ?? 0 })
  }
  return out
}

/** 导出为 JSON 字符串（用于手动备份） */
export function exportProgress(): string {
  return JSON.stringify(loadProgress(), null, 2)
}

/** 从 JSON 导入 */
export function importProgress(json: string): { ok: boolean; message: string } {
  try {
    const parsed = JSON.parse(json) as UserProgress
    if (typeof parsed !== 'object' || !('revision' in parsed)) throw new Error('格式不正确')
    const merged = mergeProgress(emptyProgress(), parsed)
    saveProgress(merged)
    return { ok: true, message: '导入成功' }
  } catch (e) {
    return { ok: false, message: `导入失败：${e instanceof Error ? e.message : e}` }
  }
}

export function clearProgress(): void {
  localStorage.removeItem(STORAGE_KEY)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(emptyProgress()))
}

// 网络恢复时自动同步
if (typeof window !== 'undefined') {
  window.addEventListener('online', () => {
    if (dirty || getPairCode()) void pushToServer()
  })
  if (getPairCode()) {
    // 启动后延迟拉取，给 UI 优先渲染时间
    window.setTimeout(() => void pullFromServer(), 1500)
  }
}

export { dirty as isDirty }
