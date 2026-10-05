/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * evaluator.ts — 实时弹奏评测引擎
 *
 * 输入源：
 *   - onScreen  屏幕键盘 / 触摸
 *   - computer  电脑键盘（QWERTY 映射）
 *   - midi      Web MIDI 外接琴
 *   - mic       麦克风（YIN 基频检测 + 能量起音检测）
 *
 * 评分维度（每项 0-100，加权得总分）：
 *   音高准确度 pitch      —— 弹对音了吗
 *   节奏准确度 rhythm     —— 在对的时间弹了吗（与目标时值网格比对）
 *   力度表现  dynamics    —— 强弱层次（麦克风/力度敏感键盘可得）
 *   连贯流畅  fluency     —— 有没有卡顿、多余音、时值崩塌
 *   指法正确  fingering   —— 用了谱面指定的指法吗
 */

import { midiToName } from './music'

export type InputSource = 'onScreen' | 'computer' | 'midi' | 'mic'

export interface PlayedNote {
  midi: number
  /** 相对开始时间（秒） */
  time: number
  /** 按住时长（秒） */
  duration: number
  /** 力度 0..1 */
  velocity: number
  /** 指法（MIDI 键盘可得） */
  finger?: number
  source: InputSource
}

export interface TargetNote {
  midi: number
  /** 相对开始时间（秒） */
  time: number
  /** 目标时长（秒） */
  duration: number
  finger?: number
  measure: number
  hand: 'right' | 'left'
}

export interface NoteJudgement {
  targetIndex: number
  status: 'correct' | 'wrongPitch' | 'missed' | 'extra'
  played?: PlayedNote
  /** 音分偏差（仅 wrongPitch 且接近时有效） */
  centsOff?: number
  /** 时间偏差（秒），负=早 正=晚 */
  timeDelta?: number
  message: string
}

export interface EvaluationResult {
  totalScore: number
  pitchScore: number
  rhythmScore: number
  dynamicsScore: number
  fluencyScore: number
  fingeringScore: number
  judgements: NoteJudgement[]
  stats: {
    expected: number
    played: number
    correct: number
    wrongPitch: number
    missed: number
    extra: number
    averageCentsOff: number
    averageTimeDelta: number
    tempo: number
    /** 节奏稳定度（标准差越小越好） */
    rhythmConsistency: number
    longestStreak: number
    durationSeconds: number
  }
  summary: string
  advice: string[]
}

export interface EvaluatorOptions {
  /** 时间容差（秒），超出即视为错拍 */
  timingTolerance?: number
  /** 允许的半音误差（1 半音内仍算「接近」） */
  pitchTolerance?: number
  /** 评分权重 */
  weights?: Partial<Record<'pitch' | 'rhythm' | 'dynamics' | 'fluency' | 'fingering', number>>
  /** 是否评测指法（只有 MIDI 键盘有指法信息） */
  gradeFingering?: boolean
}

const DEFAULT_WEIGHTS = {
  pitch: 0.35,
  rhythm: 0.3,
  dynamics: 0.12,
  fluency: 0.15,
  fingering: 0.08,
}

function median(values: number[]): number {
  if (!values.length) return 0
  const s = [...values].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

function stdev(values: number[]): number {
  if (values.length < 2) return 0
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

const NOTE_NAMES_CN = ['C', 'C♯', 'D', 'D♯', 'E', 'F', 'F♯', 'G', 'G♯', 'A', 'A♯', 'B']

function noteName(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  const oct = Math.floor(midi / 12) - 1
  return `${NOTE_NAMES_CN[pc]}${oct}`
}

/**
 * 音高对齐（DTW 风格的对齐算法）
 * 目标和演奏都是时间有序的音符序列，允许漏音、错音、多音。
 * 用「二分/贪心 + 动态规划」求最优匹配。
 */
function alignNotes(targets: TargetNote[], played: PlayedNote[], opts: { pitchTolerance: number; timeTolerance: number }): NoteJudgement[] {
  const n = targets.length
  const m = played.length
  // dp[i][j] = targets[0..i) 与 played[0..j) 的最优匹配代价
  // 代价：匹配=0/1，漏音=漏音罚分，多音=多音罚分
  const MISS_PENALTY = 1.0
  const EXTRA_PENALTY = 0.8
  const WRONG_PENALTY = 1.6

  const cost = (i: number, j: number): number => {
    const t = targets[i]
    const p = played[j]
    const semi = p.midi - t.midi
    const dt = Math.abs(p.time - t.time)
    if (Math.abs(semi) <= opts.pitchTolerance && dt <= opts.timeTolerance * 4) {
      // 音高正确：代价随时间偏差与音准偏差增长
      const timeCost = Math.min(1, dt / (opts.timeTolerance * 3))
      const cents = Math.abs(semi) * 100
      const pitchCost = Math.min(1, cents / 100)
      return 0.15 * timeCost + 0.35 * pitchCost
    }
    if (Math.abs(semi) <= opts.pitchTolerance) return 0.8 // 音对但太晚/太早
    if (Math.abs(semi) <= 2) return WRONG_PENALTY // 接近但错
    return WRONG_PENALTY + 0.6
  }

  // 滚动数组
  const INF = 1e9
  let prev = new Float64Array(m + 1)
  let cur = new Float64Array(m + 1)
  const bt = new Uint8Array((n + 1) * (m + 1)) // 0=skip target, 1=skip played, 2=match

  for (let j = 1; j <= m; j++) {
    prev[j] = prev[j - 1] + EXTRA_PENALTY
    bt[0 * (m + 1) + j] = 1
  }

  for (let i = 1; i <= n; i++) {
    cur[0] = prev[0] + MISS_PENALTY
    bt[i * (m + 1) + 0] = 0
    for (let j = 1; j <= m; j++) {
      const matchCost = prev[j - 1] + cost(i - 1, j - 1)
      const skipTarget = prev[j] + MISS_PENALTY
      const skipPlayed = cur[j - 1] + EXTRA_PENALTY
      const best = Math.min(matchCost, skipTarget, skipPlayed)
      cur[j] = best
      bt[i * (m + 1) + j] = best === matchCost ? 2 : best === skipTarget ? 0 : 1
    }
    const tmp = prev
    prev = cur
    cur = tmp
    cur.fill(0)
  }

  // 回溯
  const result: NoteJudgement[] = new Array(n)
  let i = n
  let j = m
  const pendingJudgements: NoteJudgement[] = []

  while (i > 0 || j > 0) {
    const b = i >= 0 && j >= 0 ? bt[i * (m + 1) + j] : 2
    if (i > 0 && j > 0 && b === 2) {
      const t = targets[i - 1]
      const p = played[j - 1]
      const semi = p.midi - t.midi
      const dt = p.time - t.time
      const correct = Math.abs(semi) <= opts.pitchTolerance && Math.abs(dt) <= opts.timeTolerance * 3
      result[i - 1] = {
        targetIndex: i - 1,
        status: correct ? 'correct' : 'wrongPitch',
        played: p,
        centsOff: semi * 100,
        timeDelta: dt,
        message: correct
          ? dt < -opts.timeTolerance * 1.2
            ? `${noteName(t.midi)} ✓ 稍早`
            : dt > opts.timeTolerance * 1.2
              ? `${noteName(t.midi)} ✓ 稍晚`
              : `${noteName(t.midi)} ✓`
          : semi !== 0
            ? `应为 ${noteName(t.midi)}，弹成 ${noteName(p.midi)}`
            : `${noteName(t.midi)} 偏差过大`,
      }
      i--
      j--
    } else if (i > 0 && (j === 0 || b === 0)) {
      const t = targets[i - 1]
      result[i - 1] = {
        targetIndex: i - 1,
        status: 'missed',
        message: `漏音：${noteName(t.midi)}（第 ${t.measure} 小节）`,
      }
      i--
    } else if (j > 0) {
      const p = played[j - 1]
      pendingJudgements.push({
        targetIndex: -1,
        status: 'extra',
        played: p,
        message: `多余音：${noteName(p.midi)}`,
      })
      j--
    }
  }
  void median
  return result.filter(Boolean).concat(pendingJudgements.reverse())
}

/**
 * 主评测入口
 */
export function evaluate(
  targets: TargetNote[],
  played: PlayedNote[],
  options: EvaluatorOptions = {},
): EvaluationResult {
  const timingTolerance = options.timingTolerance ?? 0.14
  const pitchTolerance = options.pitchTolerance ?? 0
  const weights = { ...DEFAULT_WEIGHTS, ...options.weights }
  const gradeFingering = options.gradeFingering ?? false

  if (targets.length === 0) {
    return {
      totalScore: 0,
      pitchScore: 0,
      rhythmScore: 0,
      dynamicsScore: 0,
      fluencyScore: 0,
      fingeringScore: 0,
      judgements: [],
      stats: {
        expected: 0, played: played.length, correct: 0, wrongPitch: 0, missed: 0, extra: played.length,
        averageCentsOff: 0, averageTimeDelta: 0, tempo: 0, rhythmConsistency: 0,
        longestStreak: 0, durationSeconds: 0,
      },
      summary: '没有可评测的目标音符',
      advice: [],
    }
  }

  const judgements = alignNotes(targets, played, { pitchTolerance, timeTolerance: timingTolerance })

  const matched = judgements.filter((j) => j.played)
  const correct = judgements.filter((j) => j.status === 'correct')
  const wrongPitch = judgements.filter((j) => j.status === 'wrongPitch')
  const missed = judgements.filter((j) => j.status === 'missed')
  const extra = judgements.filter((j) => j.status === 'extra')

  // 整体时值偏移与节奏抖动（供评分、统计、反馈共用）
  const timeDeltas = matched.map((j) => j.timeDelta ?? 0)
  const avgDelta = timeDeltas.length ? timeDeltas.reduce((a, b) => a + b, 0) / timeDeltas.length : 0
  const consistency = stdev(timeDeltas)

  // ── 音高分 ────────────────────────────────────────────────────────────────
  const pitchBase = targets.length > 0 ? correct.length / targets.length : 0
  // 音准细调：错音但很接近的给部分分
  let pitchPartial = 0
  for (const w of wrongPitch) {
    const cents = Math.abs(w.centsOff ?? 0)
    if (cents <= 150) pitchPartial += 0.35
    else if (cents <= 300) pitchPartial += 0.2
  }
  const pitchScore = Math.round(Math.min(100, (pitchBase + pitchPartial / targets.length) * 100))

  // ── 节奏分 ────────────────────────────────────────────────────────────────
  // 没有实际弹奏（或几乎没有）时，节奏无从谈起，必须给 0 而不是满分——
  // 否则「完全没弹」会因为「没有时值偏差」而拿到虚高的节奏分。
  let rhythmScore = 0
  if (matched.length >= Math.max(1, Math.ceil(targets.length * 0.2))) {
    const timeDeltas = matched.map((j) => j.timeDelta ?? 0)
    const avgDelta = timeDeltas.length ? timeDeltas.reduce((a, b) => a + b, 0) / timeDeltas.length : 0
    const consistency = stdev(timeDeltas)
    // 节奏稳定度：偏差标准差越小分越高（0.18s 以内视为满分）
    const consistencyScore = Math.max(0, 1 - consistency / 0.18)
    // 落点准确度：整体偏移越小分越高
    const onsetScore = Math.max(0, 1 - Math.abs(avgDelta) / 0.25)
    // 覆盖度：弹对的比例。节奏再稳，漏掉一半也不该给高分。
    const coverage = correct.length / targets.length
    rhythmScore = Math.round(
      Math.min(100, (consistencyScore * 0.32 + onsetScore * 0.23 + coverage * 0.45) * 100),
    )
  }

  // ── 力度分 ────────────────────────────────────────────────────────────────
  let dynamicsScore = 0
  if (played.length > 0) {
    const meanVel = played.reduce((a, p) => a + p.velocity, 0) / played.length
    const velVar = stdev(played.map((p) => p.velocity))
    // 有力度层次（既不太单一也不乱）给高分
    const level = Math.max(0, 1 - Math.abs(meanVel - 0.55) / 0.5)
    const range = Math.min(1, velVar / 0.12)
    dynamicsScore = Math.round(Math.min(100, (level * 0.4 + range * 0.6) * 100))
  } else {
    dynamicsScore = 0
  }

  // ── 流畅度 ────────────────────────────────────────────────────────────────
  const extraPenalty = extra.length / targets.length
  const missPenalty = missed.length / targets.length
  const wrongPenalty = wrongPitch.length / targets.length
  const fluencyScore = Math.round(Math.max(0, Math.min(100, (1 - (extraPenalty * 0.8 + missPenalty * 0.6 + wrongPenalty * 0.4)) * 100)))

  // ── 指法分 ────────────────────────────────────────────────────────────────
  let fingeringScore = 0
  if (gradeFingering && matched.length) {
    const graded = matched.filter((j) => targets[j.targetIndex]?.finger)
    if (graded.length) {
      const right = graded.filter((j) => j.played!.finger === targets[j.targetIndex].finger).length
      fingeringScore = Math.round((right / graded.length) * 100)
    }
  } else {
    // 无指法信息时，用「音准接近度」折算，避免该项白送满分或零分
    const nearCount = wrongPitch.filter((w) => Math.abs(w.centsOff ?? 0) <= 200).length
    fingeringScore = Math.round(Math.max(0, Math.min(100, 70 + nearCount * 5 - extra.length * 3)))
  }

  // ── 总分 ──────────────────────────────────────────────────────────────────
  const raw =
    pitchScore * weights.pitch +
    rhythmScore * weights.rhythm +
    dynamicsScore * weights.dynamics +
    fluencyScore * weights.fluency +
    fingeringScore * weights.fingering
  const weightSum = Object.values(weights).reduce((a, b) => a + b, 0)
  const totalScore = Math.round(raw / weightSum)

  // ── 连击统计 ──────────────────────────────────────────────────────────────
  let longestStreak = 0
  let cur = 0
  for (const j of judgements) {
    if (j.status === 'correct') { cur++; longestStreak = Math.max(longestStreak, cur) }
    else cur = 0
  }

  // ── 速度 ──────────────────────────────────────────────────────────────────
  const span = played.length ? played[played.length - 1].time + played[played.length - 1].duration - played[0].time : 0
  const targetSpan = targets.length ? targets[targets.length - 1].time + targets[targets.length - 1].duration - targets[0].time : 0
  const tempo = targetSpan > 0 ? Math.round((span / targetSpan) * 100) : 100

  // ── 评语与建议 ────────────────────────────────────────────────────────────
  const { summary, advice } = buildFeedback({
    totalScore, pitchScore, rhythmScore, dynamicsScore, fluencyScore, fingeringScore,
    correct, wrongPitch, missed, extra, consistency, avgDelta, longestStreak, targets,
  })

  return {
    totalScore,
    pitchScore,
    rhythmScore,
    dynamicsScore,
    fluencyScore,
    fingeringScore,
    judgements,
    stats: {
      expected: targets.length,
      played: played.length,
      correct: correct.length,
      wrongPitch: wrongPitch.length,
      missed: missed.length,
      extra: extra.length,
      averageCentsOff: matched.length
        ? Math.round(matched.reduce((a, j) => a + (j.centsOff ?? 0), 0) / matched.length)
        : 0,
      averageTimeDelta: Math.round(avgDelta * 1000),
      tempo,
      rhythmConsistency: Math.round(consistency * 1000) / 1000,
      longestStreak,
      durationSeconds: Math.round(span * 10) / 10,
    },
    summary,
    advice,
  }
}

interface FeedbackInput {
  totalScore: number
  pitchScore: number
  rhythmScore: number
  dynamicsScore: number
  fluencyScore: number
  fingeringScore: number
  correct: NoteJudgement[]
  wrongPitch: NoteJudgement[]
  missed: NoteJudgement[]
  extra: NoteJudgement[]
  consistency: number
  avgDelta: number
  longestStreak: number
  targets: TargetNote[]
}

function buildFeedback(f: FeedbackInput): { summary: string; advice: string[] } {
  const advice: string[] = []
  const accuracy = f.targets.length ? f.correct.length / f.targets.length : 0
  const rate = ((f.correct.length + f.wrongPitch.length) / Math.max(1, f.targets.length)) * 100

  let summary: string
  if (f.totalScore >= 92) summary = '演奏出色！音准、节奏与乐句都已到位，可以尝试提高速度或加入力度层次。'
  else if (f.totalScore >= 80) summary = '整体不错，个别细节需要打磨。继续保持稳定，先把薄弱环节补齐。'
  else if (f.totalScore >= 65) summary = '基本框架有了，但稳定性不足。建议放慢速度，把出错的地方单独练熟。'
  else if (f.totalScore >= 40) summary = '需要更多练习。建议开启「跟弹」模式，先建立正确的手感再独立演奏。'
  else summary = '先别急着求快。用节拍器把手分练到准确，再合起来。'

  // 音高
  if (f.pitchScore < 85) {
    if (f.wrongPitch.length > 0) {
      const wrongNotes = f.wrongPitch.slice(0, 4).map((w) => {
        const t = f.targets[w.targetIndex]
        return `第 ${t?.measure ?? '?'} 小节 ${noteName(t?.midi ?? 0)}`
      })
      advice.push(`音高：${wrongNotes.join('、')} 等处音准有误。先用「单音校对」功能逐音确认，确认无误再练连贯。`)
    }
    if (f.missed.length > 3) advice.push(`音高：有 ${f.missed.length} 个音漏弹，通常是手型位置不够熟悉。建议用节拍器分小节慢练。`)
  }

  // 节奏
  if (f.rhythmScore < 85) {
    if (Math.abs(f.avgDelta) > 0.09) {
      advice.push(
        f.avgDelta < 0
          ? `节奏：整体偏早约 ${Math.round(-f.avgDelta * 1000)} 毫秒。跟着节拍器的重拍落键，让声音落在拍点上而不是拍点之前。`
          : `节奏：整体偏晚约 ${Math.round(f.avgDelta * 1000)} 毫秒。提前准备手型，用节拍器把速度降到能准时落键的程度。`,
      )
    }
    if (f.consistency > 0.08) {
      advice.push(`节奏：音符之间的间隔波动 ${Math.round(f.consistency * 1000)} 毫秒，节奏不够均匀。开启节拍器，用「哒-哒-哒」均匀数拍。`)
    }
  }

  // 力度
  if (f.dynamicsScore < 70 && f.correct.length > 3) {
    advice.push('力度：音的变化偏少。试着做出「起句轻、推向高潮、渐弱收束」的层次，而不是全程一个力度。')
  }

  // 流畅度
  if (f.extra.length > 0) {
    advice.push(`流畅度：出现 ${f.extra.length} 个多余音（可能是手指滑动或重复按键）。注意抬指动作。`)
  }

  // 鼓励
  if (f.longestStreak >= 8) {
    advice.push(`👍 最长连续准确 ${f.longestStreak} 个音，保持这个状态把它扩展到整个乐句。`)
  }
  if (advice.length === 0) {
    advice.push('没有发现明显问题。可以尝试：① 提高 10% 速度重练；② 换一种音色/踏板；③ 背谱演奏一遍。')
  }

  void accuracy
  void rate
  return { summary, advice }
}

/** 从乐谱生成评测目标序列 */
export function buildTargets(
  notes: Array<{ midi: number; onset: number; duration: number; measure: number; hand: 'right' | 'left'; finger?: number; ornament?: string }>,
  opts: {
    tickPerMeasure: number
    bpm: number
    hand: 'right' | 'left' | 'both'
    measures?: [number, number]
    includeOrnaments?: boolean
    repeat?: number
  },
): TargetNote[] {
  const { tickPerMeasure, bpm, hand, measures, includeOrnaments = true } = opts
  const [num, den] = [3, 8]
  const beatsPerMeasure = num
  // tick → 秒
  const ticksPerBeat = tickPerMeasure / beatsPerMeasure
  const secondsPerTick = (60 / bpm) / ticksPerBeat

  const filtered = notes.filter((n) => {
    if (hand !== 'both' && n.hand !== hand) return false
    if (measures && (n.measure < measures[0] || n.measure > measures[1])) return false
    if (!includeOrnaments && n.ornament) return false
    return true
  })

  return filtered.map((n) => ({
    midi: n.midi,
    time: n.onset * secondsPerTick,
    duration: Math.max(0.05, n.duration * secondsPerTick),
    finger: n.finger,
    measure: n.measure,
    hand: n.hand,
  }))
}

/** 评价等级 */
export function scoreGrade(score: number): { label: string; color: string; star: number } {
  if (score >= 95) return { label: '大师级', color: '#f0b429', star: 5 }
  if (score >= 88) return { label: '优秀', color: '#38bdf8', star: 5 }
  if (score >= 78) return { label: '良好', color: '#34d399', star: 4 }
  if (score >= 65) return { label: '合格', color: '#fbbf24', star: 3 }
  if (score >= 45) return { label: '待加强', color: '#fb923c', star: 2 }
  return { label: '需重练', color: '#f87171', star: 1 }
}

export { noteName, midiToName }
