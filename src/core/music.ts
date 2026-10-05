/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * music.ts — 乐理核心库
 * 音名 / 音高 / 音程 / 调式 / 和弦 / 音阶 / 调号 / 键盘映射 / 指法编号
 *
 * 内部统一使用「音级 (diatonic step)」+「变音记号 (alteration)」双轨表示，
 * 以便正确处理五线谱定位（谱表位置只看音级）与发音频率（音高看音级+变音）。
 */

export const NOTE_NAMES_SHARP = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const
export const NOTE_NAMES_FLAT = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'] as const
export const NOTE_NAMES_NATURAL = ['C', 'D', 'E', 'F', 'G', 'A', 'B'] as const

/** 五线谱上「一个字母」对应的半音数（C=0 D=2 E=4 F=5 G=7 A=9 B=11） */
export const LETTER_SEMITONES: Record<string, number> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

/** 升号顺序 sharps / 降号顺序 flats */
export const SHARP_ORDER = ['F', 'C', 'G', 'D', 'A', 'E', 'B'] as const
export const FLAT_ORDER = ['B', 'E', 'A', 'D', 'G', 'C', 'F'] as const
/** 各调的调号（升/降）与主音字母、主音半音类 */
export const KEY_SIGNATURES: Record<string, { tonic: string; alter: number; sharps: string[]; flats: string[]; label: string }> = {
  C: { tonic: 'C', alter: 0, sharps: [], flats: [], label: 'C 大调 / a 小调' },
  G: { tonic: 'G', alter: 0, sharps: ['F'], flats: [], label: 'G 大调 / e 小调' },
  D: { tonic: 'D', alter: 0, sharps: ['F', 'C'], flats: [], label: 'D 大调 / b 小调' },
  A: { tonic: 'A', alter: 0, sharps: ['F', 'C', 'G'], flats: [], label: 'A 大调 / f# 小调' },
  E: { tonic: 'E', alter: 0, sharps: ['F', 'C', 'G', 'D'], flats: [], label: 'E 大调 / c# 小调' },
  F: { tonic: 'F', alter: 0, sharps: [], flats: ['B'], label: 'F 大调 / d 小调' },
  Bb: { tonic: 'B', alter: -1, sharps: [], flats: ['B', 'E'], label: '♭B 大调 / g 小调' },
  Eb: { tonic: 'E', alter: -1, sharps: [], flats: ['B', 'E', 'A'], label: '♭E 大调 / c 小调' },
  Ab: { tonic: 'A', alter: -1, sharps: [], flats: ['B', 'E', 'A', 'D'], label: 'A♭ 大调 / f 小调' },
  Db: { tonic: 'D', alter: -1, sharps: [], flats: ['B', 'E', 'A', 'D', 'G'], label: 'D♭ 大调 / b♭ 小调' },
  Am: { tonic: 'A', alter: 0, sharps: [], flats: [], label: 'a 小调（关系大调 C）' },
  Em: { tonic: 'E', alter: 0, sharps: ['F'], flats: [], label: 'e 小调' },
  Dm: { tonic: 'D', alter: 0, sharps: ['F', 'C'], flats: [], label: 'd 小调' },
}

/** 音级序号：C=0 … B=6 */
export function letterToStep(letter: string): number {
  return NOTE_NAMES_NATURAL.indexOf(letter.toUpperCase() as (typeof NOTE_NAMES_NATURAL)[number])
}

export function stepToLetter(step: number): string {
  return NOTE_NAMES_NATURAL[((step % 7) + 7) % 7]
}

/**
 * 音名解析 → 结构化音高
 * 支持："C4" "Bb3" "F#5" "E♭4" "C#4"
 */
export interface Pitch {
  letter: string
  alter: number // -2..+2
  octave: number // 4 = 中央 C 所在八度
  midi: number
}

export function parsePitch(token: string): Pitch {
  const m = /^([A-Ga-g])([#♯b♭]*)(-?\d+)$/.exec(token.trim())
  if (!m) throw new Error(`无法解析音名: ${token}`)
  const letter = m[1].toUpperCase()
  const acc = m[2]
  let alter = 0
  for (const ch of acc) {
    if (ch === '#' || ch === '♯') alter += 1
    if (ch === 'b' || ch === '♭') alter -= 1
  }
  const octave = parseInt(m[3], 10)
  return { letter, alter, octave, midi: letterToMidi(letter, alter, octave) }
}

export function letterToMidi(letter: string, alter: number, octave: number): number {
  return (octave + 1) * 12 + LETTER_SEMITONES[letter] + alter
}

/** MIDI 音高 → 结构化音高 */
export function midiToPitch(midi: number, preferFlats = false): Pitch {
  const step = Math.floor(midi / 12) - 1
  const pc = ((midi % 12) + 12) % 12
  const letterPc = NOTE_NAMES_SHARP.indexOf(NOTE_NAMES_SHARP[pc] as any)
  // 先取字母（忽略变音）
  const naturalLetter = (['C', 'C', 'D', 'D', 'E', 'F', 'F', 'G', 'G', 'A', 'A', 'B'] as const)[pc]
  const alter = LETTER_SEMITONES[naturalLetter] === pc ? 0 : pc > LETTER_SEMITONES[naturalLetter] ? 1 : -1
  void letterPc
  void preferFlats
  return { letter: naturalLetter, alter, octave: step, midi }
}

export function midiToName(midi: number, preferFlats = false): string {
  const p = midiToPitch(midi)
  const acc = p.alter > 0 ? '#'.repeat(p.alter) : 'b'.repeat(-p.alter)
  return `${p.letter}${acc}${p.octave}`
}

export function midiToFrequency(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12)
}

/** 音程（半音数 → 中文名 / 英文名 / 度数） */
export interface IntervalInfo {
  semitones: number
  shortZh: string
  en: string
  degree: string
  quality: string
  consonant: boolean
}

const INTERVAL_TABLE: Array<[number, string, string, string, string, boolean]> = [
  [0, '纯一度', 'Unison', '1', 'Perfect', true],
  [1, '小二度', 'Minor 2nd', '2', 'Minor', true],
  [2, '大二度', 'Major 2nd', '2', 'Major', true],
  [3, '小三度', 'Minor 3rd', '3', 'Minor', true],
  [4, '大三度', 'Major 3rd', '3', 'Major', true],
  [5, '纯四度', 'Perfect 4th', '4', 'Perfect', true],
  [6, '三全音', 'Tritone', '4', 'Augmented', false],
  [7, '纯五度', 'Perfect 5th', '5', 'Perfect', true],
  [8, '小六度', 'Minor 6th', '6', 'Minor', true],
  [9, '大六度', 'Major 6th', '6', 'Major', true],
  [10, '小七度', 'Minor 7th', '7', 'Minor', true],
  [11, '大七度', 'Major 7th', '7', 'Major', true],
  [12, '纯八度', 'Octave', '8', 'Perfect', true],
]

export function intervalInfo(semitones: number): IntervalInfo {
  const s = Math.abs(semitones)
  const found = INTERVAL_TABLE.find((i) => i[0] === s) ?? INTERVAL_TABLE[12]
  return {
    semitones,
    shortZh: found[1],
    en: found[2],
    degree: found[3],
    quality: found[4],
    consonant: found[5],
  }
}

/** 音阶 / 调式定义（半音偏移） */
export interface ScaleDef {
  id: string
  name: string
  nameEn: string
  steps: number[]
  formula: string
  family: 'major' | 'harmonicMinor' | 'melodicMinor' | 'church' | 'pentatonic' | 'blues' | 'chromatic'
  noteType: 'major' | 'minor' | 'other'
  description: string
}

export const SCALES: ScaleDef[] = [
  { id: 'major', name: '自然大调', nameEn: 'Ionian', steps: [0, 2, 4, 5, 7, 9, 11], formula: 'W-W-H-W-W-W-H', family: 'major', noteType: 'major', description: '最稳定的音阶，听感明亮开阔，是所有调性的参照系。' },
  { id: 'harmonicMinor', name: '和声小调', nameEn: 'Harmonic Minor', steps: [0, 2, 3, 5, 7, 8, 11], formula: 'W-H-W-W-H-Aug2-H', family: 'harmonicMinor', noteType: 'minor', description: '小调的核心材料，第七级升高形成属和弦，《致爱丽丝》即用其制造悬念。' },
  { id: 'melodicMinor', name: '旋律小调', nameEn: 'Melodic Minor', steps: [0, 2, 3, 5, 7, 9, 11], formula: 'W-H-W-W-W-W-H', family: 'melodicMinor', noteType: 'minor', description: '上行第六、七级升高，下行还原，古典奏鸣曲快板主题的常用材料。' },
  { id: 'naturalMinor', name: '自然小调', nameEn: 'Aeolian', steps: [0, 2, 3, 5, 7, 8, 10], formula: 'W-H-W-W-H-W-W', family: 'church', noteType: 'minor', description: '小调的基本形态，略带忧郁与自然感。' },
  { id: 'dorian', name: '多利亚调式', nameEn: 'Dorian', steps: [0, 2, 3, 5, 7, 9, 10], formula: 'W-H-W-W-W-H-W', family: 'church', noteType: 'minor', description: '小调色彩但第六级明亮，摇滚与布鲁斯的常用底色。' },
  { id: 'phrygian', name: '弗里吉亚调式', nameEn: 'Phrygian', steps: [0, 1, 3, 5, 7, 8, 10], formula: 'H-W-W-W-H-W-W', family: 'church', noteType: 'minor', description: '小二度构成的暗色色彩，弗拉门戈与金属乐的来源。' },
  { id: 'lydian', name: '利底亚调式', nameEn: 'Lydian', steps: [0, 2, 4, 6, 7, 9, 11], formula: 'W-W-W-H-W-W-H', family: 'church', noteType: 'major', description: '大调的四级升高，色彩明亮带一丝悬浮感。' },
  { id: 'mixolydian', name: '混合利底亚', nameEn: 'Mixolydian', steps: [0, 2, 4, 5, 7, 9, 10], formula: 'W-W-H-W-W-H-W', family: 'church', noteType: 'major', description: '大调七级降低，赋予大调以摇滚色彩。' },
  { id: 'majorPent', name: '大调五声', nameEn: 'Major Pentatonic', steps: [0, 2, 4, 7, 9], formula: '1-2-3-5-6', family: 'pentatonic', noteType: 'major', description: '去掉两个「不稳定音」，听感纯净无 dissonance，中国五声音阶同源。' },
  { id: 'minorPent', name: '小调五声', nameEn: 'Minor Pentatonic', steps: [0, 3, 5, 7, 10], formula: '1-3-4-5-♭7', family: 'pentatonic', noteType: 'minor', description: ' blues 的骨架，五度即 doom riff 的根音。' },
  { id: 'blues', name: '布鲁斯音阶', nameEn: 'Blues Scale', steps: [0, 3, 5, 6, 7, 10], formula: '1-♭3-4-♭5-5-♭7', family: 'blues', noteType: 'minor', description: '在小调五声上加入降五级，产生「摩擦感」。' },
]

export function scaleById(id: string): ScaleDef {
  return SCALES.find((s) => s.id === id) ?? SCALES[0]
}

/** 生成某音上的音阶 MIDI 序列 */
export function buildScale(rootMidi: number, scaleId: string): number[] {
  const sc = scaleById(scaleId)
  return sc.steps.map((s) => rootMidi + s)
}

/** 三和弦 / 七和弦定义 */
export interface ChordDef {
  id: string
  name: string
  nameEn: string
  intervals: number[]
  quality: 'major' | 'minor' | 'diminished' | 'augmented' | 'dominant7' | 'major7' | 'minor7'
  symbolCore: string
}

export const CHORDS: ChordDef[] = [
  { id: 'maj', name: '大三和弦', nameEn: 'Major', intervals: [0, 4, 7], quality: 'major', symbolCore: '' },
  { id: 'min', name: '小三和弦', nameEn: 'Minor', intervals: [0, 3, 7], quality: 'minor', symbolCore: 'm' },
  { id: 'dim', name: '减三和弦', nameEn: 'Diminished', intervals: [0, 3, 6], quality: 'diminished', symbolCore: '°' },
  { id: 'aug', name: '增三和弦', nameEn: 'Augmented', intervals: [0, 4, 8], quality: 'augmented', symbolCore: '+' },
  { id: 'dom7', name: '属七和弦', nameEn: 'Dominant 7th', intervals: [0, 4, 7, 10], quality: 'dominant7', symbolCore: '7' },
  { id: 'maj7', name: '大七和弦', nameEn: 'Major 7th', intervals: [0, 4, 7, 11], quality: 'major7', symbolCore: 'maj7' },
  { id: 'min7', name: '小七和弦', nameEn: 'Minor 7th', intervals: [0, 3, 7, 10], quality: 'minor7', symbolCore: 'm7' },
]

export function chordById(id: string): ChordDef {
  return CHORDS.find((c) => c.id === id) ?? CHORDS[0]
}

export function buildChord(rootMidi: number, chordId: string): number[] {
  return chordById(chordId).intervals.map((i) => rootMidi + i)
}

/** 三全音（减五/增四）在钢琴键盘上的位置 */
export const BLACK_KEY_PCS = new Set([1, 3, 6, 8, 10])

export function isBlackKey(midi: number): boolean {
  return BLACK_KEY_PCS.has(((midi % 12) + 12) % 12)
}

/** 指法编号 1..5（拇指→小指） */
export type Finger = 1 | 2 | 3 | 4 | 5

/**
 * 五指标准音阶/琶音指法：给定起始手指与跨度，返回每级的手指。
 * 用于自动生成指法标注（可被人工指法覆盖）。
 */
export function scaleFingering(
  steps: number[],
  startFinger: Finger = 1,
  direction: 'up' | 'down' = 'up',
): Finger[] {
  const n = steps.length
  if (n === 5) {
    // 五声音阶：1-2-3-1-2
    const pat: Finger[] = direction === 'up' ? [1, 2, 3, 1, 2] : [2, 1, 3, 2, 1]
    return steps.map((_, i) => pat[i % 5])
  }
  // 七声音阶上行 1-2-3-1-2-3-5，下行 5-3-2-1-3-2-1
  const up: Finger[] = [1, 2, 3, 1, 2, 3, 5]
  const down: Finger[] = [5, 3, 2, 1, 3, 2, 1]
  const base = direction === 'up' ? up : down
  const shift = direction === 'up' ? startFinger - 1 : 5 - startFinger
  return steps.map((_, i) => {
    const f = base[i % base.length] + shift
    return Math.min(5, Math.max(1, f)) as Finger
  })
}

/** 音名 → 唱名（简谱） */
const SOLFEGE_SHARP = ['do', 'di', 're', 'ri', 'mi', 'fa', 'fi', 'sol', 'si', 'la', 'li', 'ti']
const SOLFEGE_FLAT = ['do', 'ra', 're', 'me', 'mi', 'fa', 'se', 'sol', 'se', 'la', 'le', 'ti']

export function midiToSolfege(midi: number, preferFlats = false): string {
  const pc = ((midi % 12) + 12) % 12
  return (preferFlats ? SOLFEGE_FLAT : SOLFEGE_SHARP)[pc]
}

/** 罗马数字和弦级数（用于和声分析教学） */
export function romanNumeral(rootMidi: number, thirdMidi: number, fifthMidi: number): string {
  const third = thirdMidi - rootMidi
  const fifth = fifthMidi - rootMidi
  if (third === 4 && fifth === 7) return 'I'
  if (third === 3 && fifth === 7) return 'i'
  if (third === 3 && fifth === 6) return '°'
  if (third === 4 && fifth === 8) return '+'
  if (third === 4 && fifth === 10) return 'V⁷'
  if (third === 3 && fifth === 10) return 'v⁷'
  if (third === 4 && fifth === 11) return 'Imaj⁷'
  if (third === 3 && fifth === 10) return 'im⁷'
  return '?'
}

/** 五线谱纵向位置：返回相对中线的「度」数（半格单位），C4 = 0 位于下加一线下方… */
export function staffSteps(midi: number): number {
  // 谱表以 C4 为「下加一线下方第 1 步」参考；这里用连续步进（1 = 一个线间位置）
  return (midi - 60) / 1 * 0 // 占位，实际在 render 中使用 diatonicStep
}

/** 纯律/十二平均律音高比（用于音准教学） */
export function frequencyToCents(freq: number, targetMidi: number): number {
  return Math.round(1200 * Math.log2(freq / midiToFrequency(targetMidi)))
}
