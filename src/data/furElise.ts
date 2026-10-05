/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * furElise.ts — 《致爱丽丝》曲目定义层
 *
 * 音符数据来自 src/data/furElise.json（由 tools/lilypond-to-score.mjs 从
 * Mutopia Project 权威 LilyPond 源解析生成，底本 Breitkopf & Härtel 1888）。
 *
 * 本文件负责「教学层」：分章、和声分析、指法标注、演奏提示。
 */

import raw from './furElise.json'
import type { Piece, PieceSection, ScoreNote } from '@/core/score'

interface RawNote {
  absTick: number
  duration: number
  midi: number
  hand: 'right' | 'left'
  isChord: boolean
  chord?: number[]
  letter: string
  alter: number
  tuplet?: boolean
  ornament?: string
  dynamic?: string
  measure: number
  onset: number
  isPickup?: boolean
}

const rawNotes = raw.notes as unknown as RawNote[]
const meta = raw.meta

// ── 分章（依据 105 小节的实测主题再现位置确定） ──────────────────────────────
/**
 * 用旋律指纹自动定位主题的各次出现，避免手工标注小节号出错。
 * 主题 = m1 的右手六个音：E5 D#5 E5 B4 D5 C5
 */
function findThemeOccurrences(): number[] {
  const THEME = [76, 74, 76, 71, 74, 72]
  const rh = rawNotes.filter((n) => n.hand === 'right' && !n.ornament).sort((a, b) => a.measure - b.measure || a.onset - b.onset)
  const found: number[] = []
  for (let i = 0; i + THEME.length <= rh.length; i++) {
    let match = true
    for (let k = 0; k < THEME.length; k++) {
      if (rh[i + k].midi !== THEME[k]) { match = false; break }
    }
    if (match) found.push(rh[i].measure)
  }
  return [...new Set(found)]
}

export const themeOccurrences = findThemeOccurrences()

// ── 和声分析 ────────────────────────────────────────────────────────────────
export interface HarmonyTag {
  measure: number
  /** 罗马数字级数 */
  roman: string
  /** 中文和声名 */
  label: string
  /** 功能 */
  function: string
}

export const HARMONY_ANALYSIS: HarmonyTag[] = [
  { measure: 1, roman: 'V', label: 'E 大调', function: '属和弦 —— 以开放的三音堆叠制造悬念' },
  { measure: 2, roman: 'i', label: 'a 小调', function: '主和弦 —— 主题的第一次解答（不完全终止）' },
  { measure: 3, roman: 'V', label: 'E 大调', function: '再次悬置，问题的重述' },
  { measure: 4, roman: 'i', label: 'a 小调', function: '落回主音' },
  { measure: 5, roman: 'i', label: 'a 小调', function: '乐句下行收束' },
  { measure: 6, roman: 'V', label: 'E 大调', function: '属和弦：左手用属音级 b–d′–g♯ 琶音' },
  { measure: 9, roman: 'III', label: 'C 大调', function: '关系大调，中段明亮对比' },
  { measure: 10, roman: 'VII', label: 'G 大调', function: '下属方向的离调' },
  { measure: 11, roman: 'i', label: 'a 小调', function: '回到主调' },
  { measure: 12, roman: 'V', label: 'E 大调', function: '属和弦，准备终止' },
  { measure: 13, roman: 'V⁷', label: 'E7', function: '属七：d♯ 作为导音引入' },
  { measure: 14, roman: 'i–V', label: 'a 小调→E 大调', function: '终止式进行' },
]

// ── 指法 ────────────────────────────────────────────────────────────────────
/**
 * 右手主题的标准指法（1918 年 Breitkopf 版教学指法）。
 * 键位：1=拇指 2=食指 3=中指 4=无名指 5=小指
 */
const RH_THEME_FINGERING = [5, 4, 5, 2, 4, 3]
/** 左手 A2-E3-A3 琶音：5-2-1（低音用小指，跨八度用拇指） */
const LH_AMP_5_2_1 = [5, 2, 1]
/** 左手 E2-E3-G♯3 琶音 */
const LH_EM_5_2_1 = [5, 2, 1]
const LH_EM_5_1_3 = [5, 1, 3]

/** 给音符补指法；优先使用段落显式指定，其次按音型推断 */
function assignFingerings(notes: Array<ScoreNote & { measure: number }>, isThemeMeasure: (m: number) => boolean): void {
  // 主题句内的右手
  const perMeasure: Record<number, Array<ScoreNote & { measure: number }>> = {}
  for (const n of notes) {
    const k = n.measure * 10 + (n.hand === 'right' ? 0 : 1)
    if (!perMeasure[k]) perMeasure[k] = []
    perMeasure[k].push(n)
  }
  for (const n of notes) {
    const group = perMeasure[n.measure * 10 + (n.hand === 'right' ? 0 : 1)] ?? []
    const idx = group.indexOf(n)
    if (n.hand === 'right') {
      if (isThemeMeasure(n.measure) && idx < RH_THEME_FINGERING.length) {
        n.finger = RH_THEME_FINGERING[idx]
      } else if (n.isChord) {
        n.finger = 1
      } else {
        // 右手：旋律线默认 1（拇指）起，高音区顺延
        n.finger = Math.max(1, Math.min(5, 1 + Math.floor((n.midi - 60) / 4)))
      }
    } else {
      // 左手琶音
      if (n.midi < 45) n.finger = LH_AMP_5_2_1[Math.min(2, idx)] ?? 5
      else if (idx === 0) n.finger = 5
      else if (idx === 1) n.finger = 2
      else n.finger = 1
    }
  }
}

// ── 演奏提示（教学层核心） ──────────────────────────────────────────────────
export interface TeachingTip {
  measure: number
  title: string
  body: string
  /** 类型 */
  kind: 'technique' | 'rhythm' | 'phrasing' | 'theory' | 'warning'
}

export const TEACHING_TIPS: TeachingTip[] = [
  {
    measure: 0,
    kind: 'rhythm',
    title: '弱起的呼吸：两个十六分音符',
    body:
      '全曲从一个「不完整的小节」开始——只有两个十六分音符的 E5 与 D♯5，音乐上叫弱起（anacrusis）。' +
      '它不占满一拍，却决定了整首曲子的呼吸方式：你在第一个重拍前就已经开始了，' +
      '所以起手要轻、要准时，不要等到「正拍」才落键。',
  },
  {
    measure: 1,
    kind: 'technique',
    title: 'E–D♯ 的半音揉动：整首曲子的灵魂',
    body:
      'E5 和 D♯5 是相邻的两个键，一白一黑。来回四次（E D♯ E D♯ E）时，手要做的是「揉动」而不是「敲击」：' +
      '手腕保持放松，手指只在垂直方向做极小幅度的运动，力度要轻（乐谱标记 pp 极弱）。' +
      '指法是 5-4-5-4-5，用小指和无名指在黑键与白键之间交替——手型几乎不变，只是指尖在两个键之间滑动。',
  },
  {
    measure: 1,
    kind: 'theory',
    title: '为什么是 D♯ 而不是 E♭？',
    body:
      '同样一个黑键，记成 D♯ 还是 E♭，意义完全不同。《致爱丽丝》用的是 D♯，' +
      '因为它来自 a 小调的**和声小调**：在自然小调里第七级是 G，把它升高半音成为 G♯，' +
      '才能构成属和弦 E–G♯–B（这里左手弹的正是 G♯）。' +
      '如果写成 E♭，就成了 E♭–G 的减三和弦，音响会立刻变得不稳定。' +
      '记住这个原则：**黑键的名字由它在和弦里的功能决定，而不是习惯。**',
  },
  {
    measure: 1,
    kind: 'rhythm',
    title: '六个十六分音符 = 三个八分音符',
    body:
      '3/8 拍意味着每小节有三个「八分音符」的长度。m1 的六个十六分音符正好填满一小节，' +
      '但它们是**均分**的，不是三连音。要弹成「ti-ti-ti-ti-ti-ti」，六个音严格等时，' +
      '强弱规律是「弱—次弱—弱—弱—次弱—弱」，像小跑的脚步。',
  },
  {
    measure: 2,
    kind: 'theory',
    title: '左手为何是 A–E–A？',
    body:
      '右手在 m1 弹的是 E–B–E 三个音（属和弦 E 大调的骨架，缺少 G♯），' +
      '左手用低八度的 A–E–A 琶音在下方托住，形成 A 小调的色彩。' +
      '这是古典时期典型的「旋律＋分解和弦伴奏」织体：两只手像在对话，' +
      '所以练习时先分手，各自跑顺了再合。',
  },
  {
    measure: 2,
    kind: 'warning',
    title: '最容易出错的地方',
    body:
      'm1 的六个音虽然都在一个手型里，但**手指要提前到位**。' +
      '常见错误是用 3 指弹 B4（因为 C5 紧接着要用 3 指），导致 B4 和 C5 之间的音准塌下去。' +
      '记住：B4 用 2 指，它与拇指按 A4 的距离虽大，但手腕一转就到了。',
  },
  {
    measure: 5,
    kind: 'phrasing',
    title: '第一次真正的呼吸',
    body:
      'E5–C5–B4 是主题的下行分支，落到 A4 后停住。' +
      '这里的 A4 是一个**乐句的终点**，要做出「说完一句话换口气」的感觉——' +
      '力度可稍减弱，踏板在 A4 上换一次（不要整小节都踩着，否则 E–D♯ 的半音会糊成一片）。',
  },
  {
    measure: 9,
    kind: 'theory',
    title: '关系大调的转调：亮起来的那一刻',
    body:
      'm9 起主题移到关系大调 C 大调上。同一个旋律轮廓，' +
      '但从 a 小调的小调色彩变成了大调的明亮——这是 ABACA 回旋曲里 A 段内部的三段式结构：' +
      'A₁（a 小调）→ A₂（C 大调）→ A₁′（a 小调再现）。',
  },
  {
    measure: 21,
    kind: 'warning',
    title: '反复记号与演奏顺序',
    body:
      '本曲 A 段带有反复记号，实际演奏顺序是：A₁ 反复两遍 → A₂ 反复两遍 → A₁ 一次。' +
      '练习时按「段落」为单位练就足够了，不必去数反复遍数；但要理解结构，' +
      '否则会以为自己在重复同一段而失去方向感。',
  },
  {
    measure: 22,
    kind: 'technique',
    title: 'B 段：阿尔贝蒂伴奏',
    body:
      '进入 F 大调的 B 段（插部一）后，左手从「琶音」变成「阿尔贝蒂低音型」' +
      '（低—高—中—高的固定节奏型），右手旋律开始用十六分音符快速跑动。' +
      '这一段是全曲的分水岭：前面是「歌唱」，这里是「舞蹈」。' +
      '难点在于两手节奏完全不同步，左手要像节拍器一样稳，右手才能自由。',
  },
  {
    measure: 62,
    kind: 'technique',
    title: 'C 段：八度持续音与半音下行',
    body:
      'C 段（插部二）是全曲的戏剧高潮。左手在低音 A 上反复奏出八度，' +
      '像心跳一样持续；右手则密集地做半音阶下行，制造几乎要崩溃的紧张感。' +
      '这里力度可以推到 f（强），但注意左手八度的掌关节要撑住，' +
      '不要用手腕硬压，否则很快就会疲劳。',
  },
]

// ── 章节 ────────────────────────────────────────────────────────────────────
function buildSections(): PieceSection[] {
  const marks = themeOccurrences
  const [a1, a2, a1b, ...rest] = marks
  // 末小节从数据推导：写死 104 是旧版（解析器有 bug、只有 105 小节）的遗留，
  // 解析器修好后全曲 125 小节，写死会让尾声章节少覆盖 20 小节。
  const LAST_MEASURE = Math.max(...rawNotes.map((n) => n.measure))
  return [
    {
      id: 'intro',
      name: '第 0 章 · 弱起与第一个乐句',
      nameEn: 'Anacrusis & Phrase 1',
      startMeasure: 0,
      endMeasure: 2,
      form: 'A₁',
      key: 'a小调',
      difficulty: 1,
      bpm: 52,
      summary: '两个十六分音符的弱起 + 全曲最著名的 E–D♯ 揉动动机。以极弱（pp）开始，像耳语。',
      focus: [
        '掌握 3/8 拍的计数：每小节三个「1 2 3」',
        'E5–D♯5 用 5-4 指做极轻的揉动',
        '六个十六分音符严格等时，不要弹成三连音',
        '左手 A–E–A 琶音要平稳如呼吸',
      ],
    },
    {
      id: 'a1b',
      name: '第 1 章 · 主题的下行分支',
      nameEn: 'Descending Branch',
      startMeasure: 3,
      endMeasure: 8,
      form: 'A₁',
      key: 'a小调',
      difficulty: 2,
      bpm: 56,
      summary: '主题的第二次陈述与 E–C–B–A 的下行收束。开始出现「乐句呼吸」的概念。',
      focus: [
        'm5 的 E5–C5–B4 是第一次真正的旋律转向',
        'A4 处的换气感：力度弱化，踏板在此更换',
        '双手分练后再合，保持左手的均匀',
      ],
    },
    {
      id: 'a2',
      name: '第 2 章 · C 大调的中段（A₂）',
      nameEn: 'Phrase 2 in C Major',
      startMeasure: a2 ?? 9,
      endMeasure: 14,
      form: 'A₂',
      key: 'C大调',
      difficulty: 2,
      bpm: 56,
      summary: '主题移到关系大调 C 大调，明亮的光线出现。是 A 段内部的三段式对比。',
      focus: [
        '听辨调性的转变：从 a 小调的小调色彩转为 C 大调',
        '右手旋律的十六分音符流动要连贯',
        '理解关系大小调（relative major/minor）的概念',
      ],
    },
    {
      id: 'a1return',
      name: '第 3 章 · A 段再现（A₁′）',
      nameEn: 'Recapitulation of A₁',
      startMeasure: a1b ?? 15,
      endMeasure: 22,
      form: 'A₁′',
      key: 'a小调',
      difficulty: 3,
      bpm: 60,
      summary: '主题在 a 小调完整再现，随后引向 B 部。带反复记号。',
      focus: [
        '完整背谱演奏 A₁′，不看谱也能记住指法',
        '注意反复记号的演奏顺序',
        '为进入 B 段（阿尔贝蒂伴奏）做准备',
      ],
    },
    {
      id: 'b1',
      name: '第 4 章 · 插部一：F 大调的舞蹈（B₁）',
      nameEn: 'Episode I in F Major',
      startMeasure: 23,
      endMeasure: 36,
      form: 'B₁',
      key: 'F大调',
      difficulty: 3,
      bpm: 66,
      summary: '阿尔贝蒂低音伴奏 + 快速十六分旋律。全曲节奏最活跃的一段。',
      focus: [
        '左手阿尔贝蒂低音必须像节拍器一样稳定',
        '右手十六分音符的连奏与均匀',
        '装饰音（倚音）从正拍开始',
      ],
    },
    {
      id: 'a2',
      name: '第 5 章 · A 段第三次陈述',
      nameEn: 'Third Statement of A',
      startMeasure: 37,
      endMeasure: 52,
      form: 'A₁+A₂',
      key: 'a小调 / C大调',
      difficulty: 3,
      bpm: 60,
      summary: '回旋曲的第一次「归巢」：主题在完整形态下再现（三个乐句全在）。',
      focus: ['完整演奏三个乐句的对比', '为进入 C 段积累能量'],
    },
    {
      id: 'c',
      name: '第 6 章 · 插部二：C 段的高潮',
      nameEn: 'Episode II — The Climax',
      startMeasure: 53,
      endMeasure: 77,
      form: 'C',
      key: 'd和声小调 / a小调',
      difficulty: 4,
      bpm: 60,
      summary: '八度持续音 + 半音阶下行的戏剧性张力。全曲的力度与情感顶点。',
      focus: [
        '左手八度持续音：掌关节支撑，避免手腕压键',
        '右手半音下行的指法与均匀',
        '力度层次：pp → f → 渐弱',
        '八度段落（8va）的实际音高换算',
      ],
    },
    {
      id: 'final',
      name: '第 7 章 · 尾声与全曲收束',
      nameEn: 'Coda & Closing',
      startMeasure: 78,
      endMeasure: LAST_MEASURE,
      form: 'A + 尾声',
      key: 'a小调',
      difficulty: 4,
      bpm: 56,
      summary: '主题在 pp 中回归，以渐慢（rit.）与渐弱收尾于不完全终止——留白是贝多纳的告别。',
      focus: [
        '主题最后一次陈述要最轻、最干净',
        '渐慢渐弱的尺度控制',
        '注意最后落在 a 小调的主和弦上',
      ],
    },
  ]
}

export const sections = buildSections()

// ── 组装成 Piece ────────────────────────────────────────────────────────────
const notes: Array<ScoreNote & { measure: number }> = rawNotes.map((n) => ({
  measure: n.measure,
  onset: n.onset,
  duration: n.duration,
  midi: n.midi,
  chord: n.chord,
  hand: n.hand,
  isChord: n.isChord,
  ornament: n.ornament === 'appoggiatura' ? 'appoggiatura' : n.ornament === 'grace' ? 'grace' : undefined,
  tuplet: n.tuplet,
  dynamic: n.dynamic,
}))

const themeMeasures = new Set(themeOccurrences)
assignFingerings(notes, (m) => themeMeasures.has(m))

// 每小节信息
const measures = []
for (let i = 0; i <= meta.totalMeasures; i++) {
  const h = HARMONY_ANALYSIS.find((x) => x.measure === i)
  const dyn = notes.find((n) => n.measure === i && n.dynamic)?.dynamic
  measures.push({
    index: i,
    roman: h?.roman,
    harmony: h?.label,
    chordSymbol: h ? `${h.roman}` : undefined,
    dynamic: dyn,
    note: h?.function,
  })
}

export const furElise: Piece = {
  id: 'fur-elise',
  title: meta.title,
  titleOriginal: meta.titleOriginal,
  subtitle: meta.subtitle,
  composer: meta.composer,
  year: meta.year,
  catalog: meta.catalog,
  key: meta.key,
  timeSignature: meta.timeSignature as [number, number],
  tempoMark: meta.tempoMark,
  defaultBpm: meta.defaultBpm,
  measures,
  sections,
  notes,
  totalMeasures: meta.totalMeasures,
}

/** 章节内的音符（含装饰音） */
export function notesOfSection(section: PieceSection) {
  return notes.filter((n) => n.measure >= section.startMeasure && n.measure <= section.endMeasure)
}

/** 该章节的建议练习序列：右手 → 左手 → 双手 */
export function practiceSequence(section: PieceSection): Array<{ hand: 'right' | 'left' | 'both'; label: string }> {
  const hasBoth = notesOfSection(section).some((n) => n.hand === 'right') && notesOfSection(section).some((n) => n.hand === 'left')
  if (!hasBoth) return [{ hand: 'right', label: '单手练习' }]
  return [
    { hand: 'right', label: '① 右手慢练' },
    { hand: 'left', label: '② 左手慢练' },
    { hand: 'both', label: '③ 双手合练' },
  ]
}

export { themeOccurrences as themeMeasuresList }