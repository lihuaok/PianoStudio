/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * interpretation.ts — 演奏诠释层（自动演奏的"音乐性"来源）
 *
 * 乐谱数据 src/data/furElise.json（Mutopia/LilyPond 解析）只给了音高与时值，
 * **没有任何力度（dynamic）与踏板标记**——这是机读乐谱的常态。
 * 本层负责把"音符序列"变成"演奏"：
 *
 *  1. 结构基调：按 ABACA 回旋曲式给每段一个力度基调（A 段 pp、B 段 mp、C 段 f、尾声 pp）。
 *  2. 乐句划分：按旋律的呼吸点（长音 / 句末留白）切分乐句，长度约束 2–8 小节。
 *  3. 力度曲线：手别平衡 → 段落基调 → 乐句拱形（渐强渐弱）→ 拍点重音 →
 *     旋律突出（右手最高音）→ 装饰音轻奏 → 人性化微扰。
 *  4. 踏板推导：按和声签名变化换踏板；密集十六分段落自动降级为"半踏板"，
 *     避免 E–D♯ 这类半音进行被踩糊；C 段允许长踏板；曲末长踏板收束。
 *  5. 弹性速度（rubato）：乐句内做幅度极小的速度起伏，时间轴保持严格单调递增。
 *
 * 全部为纯函数，不依赖 DOM / Web Audio，可用 node 直接单元测试（tools/autoplay-test.mjs）。
 */

import { toFlatEvents, type FlatEvent, type Piece } from '@/core/score'

export type Hand = 'right' | 'left'

export interface AutoNote {
  /** 在扁平事件表中的序号（稳定 id，用于高亮与跳转） */
  index: number
  midi: number
  /** 和弦的全部音高（单音时长度为 1） */
  midis: number[]
  /** 起始拍（拍 = timeSignature[0] 定义的拍，本曲 3/8 → 拍 = 八分音符） */
  beat: number
  /** 时值（拍） */
  durBeats: number
  /** 力度 0..1 */
  velocity: number
  hand: Hand
  measure: number
  isChord: boolean
  ornament?: string
  /** 当前处于踏板踩下状态时为真（供共鸣与制音使用） */
  pedalDown: boolean
  /** 该音是否旋律声部（右手最高音） */
  isMelody: boolean
}

export type PedalKind = 'full' | 'half' | 'legato' | 'cadence'

export interface PedalSpan {
  /** 踩下（拍） */
  downBeat: number
  /** 抬起（拍） */
  upBeat: number
  /** 踏板深度 0..1（half≈0.5） */
  depth: number
  kind: PedalKind
  /** 覆盖的小节（用于 UI 显示） */
  measures: [number, number]
}

export interface Phrase {
  startMeasure: number
  endMeasure: number
  startBeat: number
  endBeat: number
  /** 该乐句所属曲式（A₁ / B₁ / C …） */
  form: string
  /** 力度基调 */
  tone: number
}

export interface AutoPlayScore {
  notes: AutoNote[]
  pedals: PedalSpan[]
  phrases: Phrase[]
  /**
   * 首音的拍号位置。本曲有弱起（anacrusis），首音在 m1 之前 → **负数**（本曲 -3）。
   * 播放器的时间原点必须以此为准，否则弱起的音（正是最著名的 E–D♯）会被"还没到 0 拍"跳过。
   */
  startBeat: number
  /** 实际跨度（totalBeats - startBeat），即真正需要演奏的拍数 */
  spanBeats: number
  /** 全曲末尾拍 */
  totalBeats: number
  /** 小节数（含弱起小节） */
  measureCount: number
  beatsPerMeasure: number
  title: string
}

export interface InterpretationOptions {
  /** 人性化微扰幅度 0..1（0 = 完全机械） */
  humanize?: number
  /** 弹性速度幅度 0..1（0 = 严格节拍） */
  rubato?: number
  /** 踏板启用 */
  pedal?: boolean
  /** 整体力度缩放（0.6 = 更轻，1.2 = 更响） */
  gain?: number
  /** 伪随机种子（固定种子 → 每次演奏完全一致，可复现） */
  seed?: number
}

/* ────────────────────────────────────────────────────────────────────────────
 * 工具
 * ────────────────────────────────────────────────────────────────────────── */

/** 确定性伪随机（mulberry32）：同一 seed 永远得到同一序列 */
function makeRandom(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v))

/** 曲式 → 力度基调（A 段 pp 耳语，C 段 f 高潮，尾声回到耳语） */
function toneOfForm(form: string): number {
  if (form.includes('C')) return 1.15 // 插部二：全曲高潮
  if (form.includes('尾声') || form.includes('Coda')) return 0.7 // 尾声：回归耳语
  if (form.includes('B')) return 0.95 // 插部一：舞蹈
  return 0.8 // A 段：pp–p
}

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 乐句划分
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 按"呼吸点"切乐句：
 *  - 候选断点 = 小节交界处，且（该小节最后一个音时值 ≥ 1 拍）或（与下一音间隔 ≥ 0.5 拍）
 *  - 约束：单句 2..8 小节，超出则强制断开
 */
export function buildPhrases(piece: Piece, events: FlatEvent[]): Phrase[] {
  const bpm = piece.timeSignature[0] // 每小节拍数（3/8 → 3）
  const lastMeasure = Math.max(...events.map((e) => e.measure))
  const measureStartBeat = (m: number) => (m - 1) * bpm

  const byMeasure = new Map<number, FlatEvent[]>()
  for (const e of events) {
    if (!byMeasure.has(e.measure)) byMeasure.set(e.measure, [])
    byMeasure.get(e.measure)!.push(e)
  }

  const formOf = (m: number) => piece.sections.find((s) => m >= s.startMeasure && m <= s.endMeasure)?.form ?? 'A'

  const isBreath = (m: number): boolean => {
    const here = (byMeasure.get(m) ?? []).filter((e) => e.hand === 'right')
    const next = (byMeasure.get(m + 1) ?? []).filter((e) => e.hand === 'right')
    if (!here.length) return true
    const last = here[here.length - 1]
    if (last.durationBeats >= 1) return true // 长音收束
    if (!next.length) return true
    const gap = next[0].onsetBeat - (last.onsetBeat + last.durationBeats)
    if (gap >= 0.5) return true // 句末留白
    return false
  }

  const phrases: Phrase[] = []
  let start = 1
  for (let m = 1; m <= lastMeasure; m++) {
    const len = m - start + 1
    const sectionEnd = piece.sections.find((s) => start >= s.startMeasure && start <= s.endMeasure)?.endMeasure ?? lastMeasure
    const atSectionEnd = m >= sectionEnd
    if (atSectionEnd || (len >= 2 && isBreath(m)) || len >= 8) {
      phrases.push({
        startMeasure: start,
        endMeasure: m,
        startBeat: measureStartBeat(start),
        endBeat: measureStartBeat(m + 1),
        form: formOf(start),
        tone: toneOfForm(formOf(start)),
      })
      start = m + 1
    }
  }
  if (start <= lastMeasure) {
    phrases.push({
      startMeasure: start,
      endMeasure: lastMeasure,
      startBeat: measureStartBeat(start),
      endBeat: measureStartBeat(lastMeasure + 1),
      form: formOf(start),
      tone: toneOfForm(formOf(start)),
    })
  }
  return phrases
}

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 踏板推导
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * 每小节的"和声签名"。
 * 只取**左手**（分解和弦/阿尔贝蒂低音/持续八度）——踏板跟的是和声，不是旋律。
 * 若把右手旋律也算进来，十六分跑动会让踏板每小节断一次，踩成"点踏板"，既机械又糊。
 */
function harmonySignature(events: FlatEvent[], measure: number): string {
  const left = events.filter((e) => e.measure === measure && e.hand === 'left').map((e) => e.midi)
  if (!left.length) return ''
  const bass = Math.min(...left)
  const pcs = [...new Set(left.map((m) => m % 12))].sort((a, b) => a - b).join(',')
  return `${bass % 12}|${pcs}`
}

/** 小节内右手音符密度（音/拍） */
function rightHandDensity(events: FlatEvent[], measure: number, beatsPerMeasure: number): number {
  const n = events.filter((e) => e.measure === measure && e.hand === 'right').length
  return n / beatsPerMeasure
}

/**
 * 推导踏板：
 *  - 和声签名变化 → 换踏板（在小节线上抬起后立刻踩下，抬起略提前，模拟真实换踏板）
 *  - 密集段落（十六分跑动，>2 音/拍）→ half pedal（浅踏板，防止半音糊成一片）
 *  - C 段（高潮）→ full，允许跨 3 小节
 *  - 曲末 → cadence（收束长踏板）
 */
export function derivePedal(piece: Piece, events: FlatEvent[]): PedalSpan[] {
  const bpmBeats = piece.timeSignature[0]
  const lastMeasure = Math.max(...events.map((e) => e.measure))
  const GAP = 0.22 // 换踏板的"呼吸"间隙（拍）

  const spans: PedalSpan[] = []
  let curStart: number | null = null
  let curSig = ''
  let curLen = 0

  const push = (downM: number, upM: number, kind: PedalKind, depth: number) => {
    const downBeat = (downM - 1) * bpmBeats
    const upBeat = Math.max(downBeat + 0.6, (upM - 1) * bpmBeats - GAP * 0.5)
    spans.push({ downBeat, upBeat, depth, kind, measures: [downM, upM] })
  }

  const formOf = (m: number) => piece.sections.find((s) => m >= s.startMeasure && m <= s.endMeasure)?.form ?? 'A'

  for (let m = 1; m <= lastMeasure + 1; m++) {
    let sig = m <= lastMeasure ? harmonySignature(events, m) : ''
    if (m > lastMeasure) {
      if (curStart !== null) push(curStart, lastMeasure + 1, 'cadence', 1)
      break
    }
    if (sig === '') sig = curSig // 无左手音的小节（长休止/纯右手）沿用上一和声
    if (sig === '') continue
    const dense = rightHandDensity(events, m, bpmBeats) > 2
    const form = formOf(m)
    const maxLen = form.includes('C') ? 3 : dense ? 1 : 2
    const kind: PedalKind = dense ? 'half' : form.includes('C') ? 'full' : 'legato'
    const depth = dense ? 0.5 : form.includes('C') ? 1 : 0.7

    if (curStart === null) {
      curStart = m
      curSig = sig
      curLen = 1
      continue
    }
    if (sig !== curSig || curLen >= maxLen) {
      push(curStart, m, kind, depth)
      curStart = m
      curSig = sig
      curLen = 1
    } else {
      curLen += 1
    }
  }
  return spans
}

/* ────────────────────────────────────────────────────────────────────────────
 * 3. 力度
 * ────────────────────────────────────────────────────────────────────────── */

/** 乐句拱形：句内先渐强到 55% 处峰值，再渐弱收束（歌唱性的来源） */
function phraseArch(t: number): number {
  const x = clamp(t, 0, 1)
  const peak = 0.55
  if (x <= peak) return 0.78 + 0.42 * (x / peak) // 0.78 → 1.20
  return 1.2 - 0.32 * ((x - peak) / (1 - peak)) // 1.20 → 0.88
}

/* ────────────────────────────────────────────────────────────────────────────
 * 4. 组装
 * ────────────────────────────────────────────────────────────────────────── */

export function buildAutoPlayScore(piece: Piece, opts: InterpretationOptions = {}): AutoPlayScore {
  const { humanize = 0.5, rubato = 0.35, pedal = true, gain = 1, seed = 20251005 } = opts
  const rand = makeRandom(seed)
  const events = toFlatEvents(piece)
  const beatsPerMeasure = piece.timeSignature[0]
  const phrases = buildPhrases(piece, events)
  const pedals = pedal ? derivePedal(piece, events) : []

  const phraseOf = (measure: number) =>
    phrases.find((p) => measure >= p.startMeasure && measure <= p.endMeasure) ?? phrases[phrases.length - 1]

  // 每小节右手最高音 → 旋律音（力度略突出）
  const melodySet = new Set<number>()
  {
    const byMeasure = new Map<number, FlatEvent[]>()
    for (const e of events) {
      if (e.hand !== 'right') continue
      if (!byMeasure.has(e.measure)) byMeasure.set(e.measure, [])
      byMeasure.get(e.measure)!.push(e)
    }
    for (const [, list] of byMeasure) {
      const top = Math.max(...list.map((e) => e.midi))
      for (let i = 0; i < list.length; i++) if (list[i].midi === top) melodySet.add(events.indexOf(list[i]))
    }
  }

  const lastMeasure = Math.max(...events.map((e) => e.measure))
  const totalBeats = Math.max(...events.map((e) => e.onsetBeat + e.durationBeats))

  const notes: AutoNote[] = events.map((e, index) => {
    const ph = phraseOf(e.measure)
    const t = ph && ph.endBeat > ph.startBeat ? (e.onsetBeat - ph.startBeat) / (ph.endBeat - ph.startBeat) : 0.5

    // 手别平衡：左手是伴奏，永远比右手弱一档（否则旋律会被自己的伴奏盖住）
    const handBase = e.hand === 'right' ? 0.72 : 0.5
    // 拍点重音：落在拍点上（含半拍）略强，弱位略弱
    const onBeat = Math.abs(e.onsetBeat - Math.round(e.onsetBeat)) < 0.01
    const beatAccent = onBeat ? (Math.round(e.onsetBeat) % beatsPerMeasure === 0 ? 1.07 : 1.0) : 0.95
    // 旋律突出
    const melodyBoost = melodySet.has(index) ? 1.07 : 1.0
    // 装饰音轻奏
    const ornFactor = e.ornament ? 0.6 : 1
    // 曲末渐弱（最后两小节）
    const tail = e.measure >= lastMeasure - 1 ? 0.72 : 1
    // 人性化微扰
    const jitter = 1 + (rand() - 0.5) * 0.06 * humanize

    let v = handBase * (ph?.tone ?? 0.86) * phraseArch(t) * beatAccent * melodyBoost * ornFactor * tail * jitter * gain
    // 和弦内部：低音略强（根音支撑）
    v = clamp(v, 0.08, 0.97)

    // 装饰音（倚音）抢前一个瞬间的时值：提前 0.12 拍、时值缩短
    const isOrnament = !!e.ornament
    const beat = isOrnament ? Math.max(0, e.onsetBeat - 0.12) : e.onsetBeat
    const durBeats = isOrnament ? Math.min(e.durationBeats, 0.45) : e.durationBeats

    return {
      index,
      midi: e.midi,
      midis: e.midis,
      beat,
      durBeats,
      velocity: v,
      hand: e.hand,
      measure: e.measure,
      isChord: e.isChord,
      ornament: e.ornament,
      pedalDown: false,
      isMelody: melodySet.has(index),
    }
  })

  // ── 弹性速度：乐句内做极小幅度的时间扭曲（严格单调递增） ──────────────
  if (rubato > 0) {
    const amount = 0.045 * rubato
    const warp = (beat: number): number => {
      const ph = phrases.find((p) => beat >= p.startBeat && beat <= p.endBeat)
      if (!ph) return beat
      const span = ph.endBeat - ph.startBeat
      if (span <= 0) return beat
      const x = (beat - ph.startBeat) / span
      // 句首略慢 → 句中略快 → 句末渐慢
      const shape = Math.sin(Math.PI * x) // 0..1..0
      const slowMask = x < 0.15 ? 1 - x / 0.15 : x > 0.82 ? (x - 0.82) / 0.18 : 0
      const delta = amount * span * (shape * 0.35 - slowMask * 0.55)
      return beat + delta
    }
    for (const n of notes) {
      const b0 = n.beat
      const b1 = n.beat + n.durBeats
      n.beat = warp(b0)
      n.durBeats = Math.max(0.05, warp(b1) - n.beat)
    }
    notes.sort((a, b) => a.beat - b.beat)
  }

  // ── 标记踏板状态 ──────────────────────────────────────────────────────
  for (const n of notes) {
    n.pedalDown = pedals.some((p) => n.beat >= p.downBeat && n.beat <= p.upBeat)
  }

  const warpedTotal = Math.max(...notes.map((n) => n.beat + n.durBeats))
  const endBeat = rubato > 0 ? warpedTotal : totalBeats
  // 弱起的音排在"第 0 拍"之前 → startBeat 为负；播放器以此为时间原点
  const startBeat = notes.length ? Math.min(0, notes[0].beat) : 0

  return {
    notes,
    pedals,
    phrases,
    startBeat,
    spanBeats: endBeat - startBeat,
    totalBeats: endBeat,
    measureCount: lastMeasure + 1,
    beatsPerMeasure,
    title: piece.title,
  }
}

/** 秒数 = 拍数 × 每拍秒数 */
export function beatsToSeconds(beats: number, bpm: number): number {
  return (beats * 60) / bpm
}

/** 预估全曲时长（秒）——以弱起为原点，而不是 0 拍 */
export function estimateDuration(score: AutoPlayScore, bpm: number): number {
  return beatsToSeconds(score.spanBeats, bpm)
}

/** 找到 ≤ 给定拍的最后一个音符索引（用于 seek / 进度回映） */
export function noteIndexAtBeat(notes: AutoNote[], beat: number): number {
  let lo = 0
  let hi = notes.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (notes[mid].beat <= beat) {
      ans = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return ans
}
