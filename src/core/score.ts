/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * score.ts — 乐谱数据模型与乐谱排版引擎
 *
 * 排版策略：
 *  - 以「小节」为排版单元，逐小节测量内容宽度并装箱到系统行。
 *  - 每个音的 x 由所在声部的累计时值比例决定，y 由五线谱阶梯位置决定。
 *  - 变音记号按「同一线上同高度」去重聚合（符合记谱惯例）。
 */

import { LETTER_SEMITONES, letterToStep, midiToPitch, midiToFrequency } from './music'

export type Hand = 'right' | 'left'

export interface ScoreNote {
  /** 小节内起始 tick（1 tick = 1/96 全小节） */
  onset: number
  /** 时值 tick */
  duration: number
  /** MIDI 音高（和弦则取最低音） */
  midi: number
  /** 和弦内全部音高 */
  chord?: number[]
  hand: Hand
  /** 指法 1..5 */
  finger?: number
  /** 是否为和弦 */
  isChord?: boolean
  /** 装饰音（倚音/回音/波音） */
  ornament?: 'appoggiatura' | 'grace' | 'turn' | 'mordent' | 'trill'
  /** 断奏/连奏 */
  articulation?: 'staccato' | 'accent' | 'tenuto' | 'marcato'
  /** 延音线连接到下一音（tie） */
  tie?: boolean
  /** 演奏提示 */
  hint?: string
  /** 三连音 */
  triplet?: boolean
  /** 六连音 */
  sextuplet?: boolean
  /** 力度标记（pp/p/f 等） */
  dynamic?: string
  /** 是否跳过（教学简化版中省略） */
  skip?: boolean
}

export interface ScoreMeasure {
  index: number
  /** 该小节的和弦标记 */
  chordSymbol?: string
  /** 罗马数字（和声分析） */
  roman?: string
  /** 该小节内的和声功能说明 */
  harmony?: string
  /** 小节线是反复记号 */
  repeatEnd?: boolean
  repeatStart?: boolean
  /** 力度标记 */
  dynamic?: string
  /** 教学注释 */
  note?: string
}

export interface PieceSection {
  id: string
  name: string
  nameEn: string
  startMeasure: number
  endMeasure: number
  /** 所属奏鸣/乐段 */
  form: string
  key: string
  difficulty: 1 | 2 | 3 | 4 | 5
  summary: string
  /** 教学要点 */
  focus: string[]
  /** 建议速度 BPM */
  bpm: number
}

export interface Piece {
  id: string
  title: string
  titleOriginal: string
  subtitle?: string
  composer: string
  year: string
  catalog: string
  key: string
  timeSignature: [number, number]
  tempoMark: string
  defaultBpm: number
  measures: ScoreMeasure[]
  sections: PieceSection[]
  /** 全曲音符（扁平，按 onset 排序，含 measure 索引） */
  notes: Array<ScoreNote & { measure: number }>
  totalMeasures: number
  /** 解析元信息（如 tickPerMeasure） */
  meta?: { tickPerMeasure?: number; [k: string]: unknown }
}

/** 小节总 tick 数 */
export function measureTicks(timeSignature: [number, number]): number {
  const [num, den] = timeSignature
  return (num * 4 * 96) / den
}

export function beatsPerMeasure(timeSignature: [number, number]): number {
  return timeSignature[0]
}

/** tick → 拍（用于节拍器） */
export function tickToBeats(tick: number, timeSignature: [number, number]): number {
  const total = measureTicks(timeSignature)
  return (tick / total) * timeSignature[0]
}

export function beatsToTicks(beats: number, timeSignature: [number, number]): number {
  const total = measureTicks(timeSignature)
  return (beats / timeSignature[0]) * total
}

/** tick → 秒 */
export function ticksToSeconds(tick: number, bpm: number, timeSignature: [number, number]): number {
  const beats = tickToBeats(tick, timeSignature)
  return (beats * 60) / bpm
}

/**
 * 五线谱纵向定位
 *
 * 内部统一返回「字母级绝对步数」：absoluteStep = octave * 7 + letterIndex（C=0）
 * 这是唯一与「音高」严格对应、与「升降号」无关的量——升降号不改变字母位置，
 * 只改变符头旁边是否画升降号，这与真实记谱规则一致。
 *
 * 高音谱表（Treble）几何：
 *   顶线 = F5 (step 38)，底线 = E4 (step 30)，中线 = B4 (step 34)
 *   以「顶线为 y=0、向下为正」，每个字母步 = lineSpacing / 2
 */
export function absoluteStep(midi: number): number {
  const p = midiToPitch(midi)
  return p.octave * 7 + letterToStep(p.letter)
}

/** 高音谱表：五线在顶线 y=0，底线 y=4*lineSpacing */
export function trebleY(midi: number, lineSpacing: number): number {
  return (TREBLE_TOP_STEP - absoluteStep(midi)) * (lineSpacing / 2)
}

/** 低音谱表：顶线 = A3，底线 = G2 */
export function bassY(midi: number, lineSpacing: number): number {
  return (BASS_TOP_STEP - absoluteStep(midi)) * (lineSpacing / 2)
}

const TREBLE_TOP_STEP = 5 * 7 + 3 // F5 = 38（高音谱表顶线）
const BASS_TOP_STEP = 3 * 7 + 5   // A3 = 26（低音谱表顶线）

/** 谱号归属：中央 C 下方用低音谱表 */
export function isBassClef(midi: number): boolean {
  return absoluteStep(midi) <= BASS_TOP_STEP
}

/** 需要多少个升降号才能正确表示该音（返回 {type, count}） */
export function accidentalFor(midi: number, keyAlter: (letter: string) => number): { type: 'sharp' | 'flat' | 'none'; count: number } {
  const p = midiToPitch(midi)
  const inKey = keyAlter(p.letter)
  const diff = p.alter - inKey
  if (diff === 0) return { type: 'none', count: 0 }
  return diff > 0 ? { type: 'sharp', count: diff } : { type: 'flat', count: -diff }
}

/** 布局结果 */
export interface LaidOutNote {
  note: ScoreNote & { measure: number }
  x: number
  /** 相对所属谱表顶线的 y（顶线为 0，向下为正） */
  y: number
  stemUp: boolean
  /** 是否需要升降号 */
  accidental: { type: 'sharp' | 'flat' | 'none'; count: number }
  noteHeadX: number
  /** 该音符位于低音谱表 */
  useBass: boolean
}

export interface LaidOutMeasure {
  measure: ScoreMeasure
  x: number
  width: number
  notes: LaidOutNote[]
  /** 该小节的起始 tick（绝对） */
  startTick: number
}

export interface LaidOutSystem {
  y: number
  measures: LaidOutMeasure[]
  width: number
  startMeasure: number
  endMeasure: number
}

export interface LayoutOptions {
  staffSpacing?: number // 线间距 px
  systemGap?: number // 系统间距
  measureGap?: number // 小节间距
  leftPad?: number
  rightPad?: number
  pageWidth?: number
  showFingering?: boolean
  showBPM?: number
  keyAlter?: (letter: string) => number
  compact?: boolean
}

const DEFAULTS: Required<Omit<LayoutOptions, 'keyAlter'>> & { keyAlter: (l: string) => number } = {
  staffSpacing: 10,
  systemGap: 118,
  measureGap: 16,
  leftPad: 26,
  rightPad: 26,
  pageWidth: 1180,
  showFingering: true,
  showBPM: 3,
  keyAlter: () => 0,
  compact: false,
}

/**
 * 乐谱排版：把音符数组装箱为若干系统行
 *
 * 每个「系统行」包含高音谱表 + 低音谱表（大谱表），
 * 系统行高度 = 顶留白 + 高音表高 + 表间距 + 低音表高 + 底留白
 */
export function layoutScore(piece: Piece, options: LayoutOptions = {}): {
  systems: LaidOutSystem[]
  height: number
  staffSpacing: number
  width: number
  staffHeight: number
} {
  const o = { ...DEFAULTS, ...options }
  const keyAlter = options.keyAlter ?? DEFAULTS.keyAlter
  const perMeasure = measureTicks(piece.timeSignature)

  const staffHeight = o.staffSpacing * 4 // 五线之间的总高度
  const systemHeight = staffHeight * 2 + o.systemGap

  // 1. 归组到小节
  const byMeasure = new Map<number, Array<ScoreNote & { measure: number }>>()
  for (const n of piece.notes) {
    if (n.skip) continue
    if (!byMeasure.has(n.measure)) byMeasure.set(n.measure, [])
    byMeasure.get(n.measure)!.push(n)
  }
  for (const arr of byMeasure.values()) arr.sort((a, b) => a.onset - b.onset || a.hand.localeCompare(b.hand))

  const measureMeta = piece.measures
  const systems: LaidOutSystem[] = []
  let currentMeasureIndex = 0
  let cursorY = 12

  const widthOfMeasure = (i: number): number => {
    const notes = byMeasure.get(i + 1) ?? []
    const hasChord = notes.some((n) => n.isChord)
    const density = notes.length
    const minW = o.compact ? 84 : 116
    let w = minW + density * (o.compact ? 4.5 : 6.2)
    if (hasChord) w += 14
    const m = measureMeta[i]
    if (m?.chordSymbol) w += 22
    return Math.max(minW, Math.min(o.compact ? 220 : 300, w))
  }

  while (currentMeasureIndex < measureMeta.length) {
    const usable = o.pageWidth - o.leftPad - o.rightPad
    const lineMeasures: number[] = []
    let lineWidth = 0
    let i = currentMeasureIndex
    while (i < measureMeta.length) {
      const w = widthOfMeasure(i)
      if (lineMeasures.length >= 2 && lineWidth + w > usable) break
      lineMeasures.push(i)
      lineWidth += w + o.measureGap
      i += 1
      if (lineWidth > usable) break
    }
    if (lineMeasures.length === 0) { lineMeasures.push(i); i += 1 }

    // 按可用宽度等比缩放
    const totalGap = o.measureGap * (lineMeasures.length - 1)
    const avail = usable - totalGap
    const rawWidths = lineMeasures.map((m) => widthOfMeasure(m))
    const rawSum = rawWidths.reduce((a, b) => a + b, 0)
    const scale = rawSum > 0 ? avail / rawSum : 1

    const laidMeasures: LaidOutMeasure[] = []
    let mx = o.leftPad
    lineMeasures.forEach((mi, idx) => {
      const w = rawWidths[idx] * scale
      const notes = (byMeasure.get(mi + 1) ?? []).map((n) => {
        const frac = n.onset / perMeasure
        const noteHeadX = mx + 16 + frac * (w - 32)
        // 该音符所属谱表的相对 y（高音表 / 低音表各自从顶线 0 起算）
        const useBass = isBassClef(n.midi)
        const y = useBass ? bassY(n.midi, o.staffSpacing) : trebleY(n.midi, o.staffSpacing)
        const chordMidis = n.chord ?? [n.midi]
        const avgY =
          chordMidis.reduce((s, m) => s + (isBassClef(m) ? bassY(m, o.staffSpacing) : trebleY(m, o.staffSpacing)), 0) /
          chordMidis.length
        // 中线位置：B4（高音）/ D3（低音）
        const midLine = useBass ? o.staffSpacing * 2 : o.staffSpacing * 2
        const stemUp = avgY < midLine
        const acc = accidentalFor(n.midi, keyAlter)
        return { note: { ...n, measure: mi + 1 }, x: noteHeadX, y, stemUp, accidental: acc, noteHeadX, useBass }
      })
      laidMeasures.push({
        measure: measureMeta[mi] ?? { index: mi + 1 },
        x: mx,
        width: w,
        notes,
        startTick: mi * perMeasure,
      })
      mx += w + o.measureGap
    })

    systems.push({
      y: cursorY,
      measures: laidMeasures,
      width: o.pageWidth,
      startMeasure: lineMeasures[0] + 1,
      endMeasure: lineMeasures[lineMeasures.length - 1] + 1,
    })
    cursorY += systemHeight
    currentMeasureIndex = i
  }

  return {
    systems,
    height: cursorY + 24,
    staffSpacing: o.staffSpacing,
    width: o.pageWidth,
    staffHeight,
  }
}

/** 提取某小节范围内的音符（分章练习用） */
export function notesInRange(piece: Piece, startMeasure: number, endMeasure: number) {
  return piece.notes.filter((n) => n.measure >= startMeasure && n.measure <= endMeasure)
}

/** 生成等时值的音高序列（用于跟弹示范） */
export interface FlatEvent {
  midi: number
  onsetBeat: number
  durationBeats: number
  hand: Hand
  finger?: number
  measure: number
  isChord: boolean
  /** 和弦的全部音高 */
  midis: number[]
  /** 装饰音类型（倚音 / 回音 …）——自动演奏据此时值微调 */
  ornament?: string
}

export function toFlatEvents(piece: Piece): FlatEvent[] {
  const perMeasure = measureTicks(piece.timeSignature)
  const nBeats = piece.timeSignature[0]
  const events: FlatEvent[] = piece.notes
    .filter((n) => !n.skip)
    .map((n) => ({
      midi: n.chord && n.chord.length > 1 ? Math.min(...n.chord) : n.midi,
      onsetBeat: ((n.measure - 1) * perMeasure + n.onset) / perMeasure * nBeats,
      durationBeats: Math.max(0.05, (n.duration / perMeasure) * nBeats),
      hand: n.hand,
      finger: n.finger,
      measure: n.measure,
      isChord: !!(n.chord && n.chord.length > 1),
      midis: n.chord && n.chord.length > 1 ? [...n.chord] : [n.midi],
      ornament: n.ornament,
    }))
  return events.sort((a, b) => a.onsetBeat - b.onsetBeat)
}

/** 音高 → 频率（供播放器使用） */
export function eventFrequency(e: FlatEvent): number {
  return midiToFrequency(e.midi)
}

export { LETTER_SEMITONES }
