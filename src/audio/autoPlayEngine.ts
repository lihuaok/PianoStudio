/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * autoPlayEngine.ts — 钢琴自动演奏引擎
 *
 * 与教学播放器 usePiecePlayer 的区别（定位互补、互不干扰）：
 *   · usePiecePlayer：给"跟弹练习"用，力度固定、无踏板、可循环单段落。
 *   · 本引擎：给"完整欣赏/示范"用，带诠释层（乐句力度、踏板、弹性速度）与采样音源升级。
 *
 * 时序精度保证（关键）：
 *   · 所有发声都排在 **AudioContext 的绝对时间轴** 上（不是 setTimeout）。
 *   · 每 25ms 轮询一次，只把未来 0.35s 内的音符写进音频时钟 → 同时存活的音频节点极少。
 *   · 界面进度由 rAF 从 audio clock 反算，且节流到 ~20fps；
 *     渲染卡顿、React 重渲染、甚至主线程阻塞几百毫秒，都不会让音跑偏
 *     （只会让"高亮"晚一点更新，声音仍在正确时刻发声）。
 */

import { getAudioEngine, type PianoPreset } from '@/audio/audioEngine'
import { SampleEngine } from '@/audio/sampleEngine'
import type { AutoPlayScore, AutoNote, PedalSpan } from '@/core/interpretation'

const LOOKAHEAD_S = 0.35
const TICK_MS = 25
const TAIL_S = 0.6
/** 踏板踩下时给音符额外延长的时值（秒）——踏板不抬，弦就不该被制音 */
const PEDAL_TAIL_S = 0.5

export interface AutoPlaySettings {
  bpm?: number
  volume?: number
  reverb?: number
  preset?: PianoPreset
  /** 是否启用踏板（延音 + 共鸣） */
  pedal?: boolean
  /** 踏板共鸣：踩下时触发极轻的八度/十二度共振，弱奏时几乎听不见，强奏时增加"厅堂感" */
  resonance?: boolean
}

export interface AutoPlaySnapshot {
  playing: boolean
  paused: boolean
  finished: boolean
  /** 当前拍（含 rubato 后的乐谱拍） */
  currentBeat: number
  /** 已播放秒数 */
  currentTime: number
  totalBeats: number
  /** 全曲时长（秒） */
  duration: number
  bpm: number
  /** 进度 0..1 */
  progress: number
  pedalDown: boolean
  pedalDepth: number
  /** 当前正在发声的音（供琴键动画联动） */
  activeNotes: number[]
  currentMeasure: number
  /** 当前曲式标签（A₁ / B₁ / C …） */
  sectionLabel: string
}

export interface AutoPlayCallbacks {
  /** 状态更新（节流 ~20fps） */
  onTick?: (s: AutoPlaySnapshot) => void
  /** 单个音符真正发声的瞬间（用于琴键动画，比 onTick 精确） */
  onNote?: (midi: number, velocity: number, note: AutoNote) => void
  onComplete?: () => void
  /** 采样音源状态变化 */
  onSampleStats?: () => void
}

interface PedalPoint {
  beat: number
  down: boolean
  depth: number
}

export class AutoPlayEngine {
  private engine = getAudioEngine()
  readonly samples: SampleEngine
  private score: AutoPlayScore | null = null

  private bpm = 126
  private volume = 0.85
  private reverb = 0.32
  /**
   * 合成回退预设。只有在采样音源尚未就绪（首次加载的前一两秒）时才会用到，
   * 因此选「柔和大钢琴」——它砍掉了纯加性合成最刺耳的高次泛音，
   * 即使短暂出现也不会与随后的采样音色形成"电子琴 → 钢琴"的断裂感。
   */
  private preset: PianoPreset = 'warm'
  private pedalEnabled = true
  private resonanceEnabled = true

  private timer: number | null = null
  private raf: number | null = null
  private running = false
  private paused = false
  private finished = false

  private cursor = 0
  private pedCursor = 0
  private startBeat = 0
  private audioStart = 0
  private pausedBeat = 0
  private pedalPoints: PedalPoint[] = []
  private pedalDown = false
  private pedalDepth = 0

  private cb: AutoPlayCallbacks = {}
  private lastTickWall = 0
  private lastSampleReport = 0

  constructor() {
    this.samples = new SampleEngine(this.engine.ctx, this.engine.dryInput, this.engine.wetInput)
  }

  /* ────────── 配置 ────────── */

  setScore(score: AutoPlayScore) {
    const wasPlaying = this.running && !this.paused
    const at = wasPlaying ? this.currentBeat() : score.startBeat
    // 先换谱再 stop：stop() 会把游标归位到"曲首"，此时必须已经是新乐谱的曲首
    this.score = score
    this.stop()
    // 预取采样：先加载"当前层"，播放过程中再按需补其它力度层
    const uniq = [...new Set(score.notes.map((n) => n.midi))]
    this.samples.prefetch(uniq, 'current')
    if (wasPlaying) this.play(at)
  }

  setCallbacks(cb: AutoPlayCallbacks) {
    this.cb = cb
  }

  /**
   * 预热采样音源。
   * 分两步，是为了"首播等待时间"与"音色完整度"两头都要：
   *   ① 先等**中间力度层**就绪（18 个采样点 ≈ 3MB）—— 只要这一步完成，
   *      点播放出来的就是真钢琴，不会有"前两个小节是电子琴"的断裂；
   *   ② 再在后台补齐弱奏层与强奏层，播放中陆续到位，不阻塞。
   * @returns 中间层是否在超时内就绪
   */
  async warmupSamples(timeoutMs = 15000): Promise<boolean> {
    if (!this.score || !this.samples.available) return false
    const uniq = [...new Set(this.score.notes.map((n) => n.midi))]
    const ok = await this.samples.prepare(uniq, timeoutMs, 'current')
    // 无论是否超时，只要清单已加载就切到采样染色（未就绪的音会自动回退合成）
    if (this.samples.available) this.engine.setVoiceSource('sample')
    this.samples.prefetch(uniq, 'all')
    return ok
  }

  /** 本曲所需音高中，实际有采样的比例（0..1，用于 UI 就绪度提示） */
  sampleCoverage(): number {
    if (!this.score || !this.samples.available) return 0
    const uniq = [...new Set(this.score.notes.map((n) => n.midi))]
    if (!uniq.length) return 0
    let ok = 0
    for (const m of uniq) if (this.samples.has(m)) ok++
    return ok / uniq.length
  }

  applySettings(s: AutoPlaySettings) {
    if (s.bpm !== undefined) this.setBpm(s.bpm)
    if (s.volume !== undefined) {
      this.volume = Math.max(0, Math.min(1.2, s.volume))
      this.engine.setMasterVolume(this.volume)
    }
    if (s.reverb !== undefined) {
      this.reverb = Math.max(0, Math.min(1, s.reverb))
      this.engine.setReverb(this.reverb)
    }
    if (s.preset !== undefined) this.preset = s.preset
    if (s.pedal !== undefined) {
      this.pedalEnabled = s.pedal
      if (!s.pedal) this.setPedal(false, 0)
    }
    if (s.resonance !== undefined) this.resonanceEnabled = s.resonance
  }

  getBpm() {
    return this.bpm
  }

  /** 每拍秒数 */
  private get spb() {
    return 60 / this.bpm
  }

  /** 实时变速：以"当前拍"为锚点重排时间轴，并撤销尚未发声的旧速度音符 */
  setBpm(bpm: number) {
    const next = Math.max(40, Math.min(200, bpm))
    if (next === this.bpm) return
    if (this.running && !this.paused) {
      const beat = this.currentBeat()
      const now = this.engine.currentTime
      // Web Audio 已排入未来的音符不会自动失效 —— 必须显式撤销，否则会先冒出一串旧速度的音
      this.engine.cancelFuture(now + 0.02)
      this.bpm = next
      this.startBeat = beat
      this.audioStart = now + 0.04
      this.cursor = this.indexAtBeat(beat)
      this.rebuildPedalCursor(beat)
    } else {
      this.bpm = next
    }
  }

  setVolume(v: number) {
    this.applySettings({ volume: v })
  }

  /* ────────── 时间映射 ────────── */

  private beatToAudio(beat: number) {
    return this.audioStart + (beat - this.startBeat) * this.spb
  }

  private currentBeat() {
    if (!this.running) return this.pausedBeat
    const raw = this.startBeat + (this.engine.currentTime - this.audioStart) / this.spb
    const lo = this.score?.startBeat ?? 0
    return Math.max(lo, Math.min(raw, this.score?.totalBeats ?? raw))
  }

  /** 时间原点（弱起为负拍）；进度与时长都相对它计算 */
  private get originBeat() {
    return this.score?.startBeat ?? 0
  }

  private beatToSeconds(beat: number) {
    return ((beat - this.originBeat) * 60) / this.bpm
  }

  private indexAtBeat(beat: number) {
    const notes = this.score?.notes ?? []
    let lo = 0
    let hi = notes.length - 1
    let ans = notes.length
    while (lo <= hi) {
      const mid = (lo + hi) >> 1
      if (notes[mid].beat >= beat) {
        ans = mid
        hi = mid - 1
      } else lo = mid + 1
    }
    return ans
  }

  private rebuildPedalCursor(beat: number) {
    this.pedCursor = this.pedalPoints.findIndex((p) => p.beat >= beat)
    if (this.pedCursor < 0) this.pedCursor = this.pedalPoints.length
    this.pedalDown = false
    this.pedalDepth = 0
  }

  /* ────────── 踏板 ────────── */

  private buildPedalPoints(pedals: PedalSpan[]): PedalPoint[] {
    const pts: PedalPoint[] = []
    for (const p of pedals) {
      pts.push({ beat: p.downBeat, down: true, depth: p.depth })
      pts.push({ beat: p.upBeat, down: false, depth: 0 })
    }
    return pts.sort((a, b) => a.beat - b.beat)
  }

  private setPedal(down: boolean, depth: number) {
    this.pedalDown = down
    this.pedalDepth = depth
    const on = down && this.pedalEnabled
    // 两套音源的踏板语义必须同步：合成声部与采样声部各有一套制音器
    this.engine.setSustainPedal(on)
    this.samples.setSustainPedal(on)
  }

  /** 当前是否正在使用真实采样音源（UI 用来展示音源状态） */
  get usingSamples(): boolean {
    return this.samples.available
  }

  /* ────────── 发声 ────────── */

  private fire(note: AutoNote, when: number) {
    const spb = this.spb
    const dur = Math.max(0.09, note.durBeats * spb)
    const tail = this.pedalDown ? PEDAL_TAIL_S * this.pedalDepth : 0
    const velocity = note.velocity

    for (const m of note.midis) {
      // ① 采样音源优先；② 未加载则回退高质量合成
      const ok = this.samples.noteOn(m, velocity, when, dur + tail, this.pedalDown)
      if (!ok) {
        this.engine.noteOn(m, { when, duration: dur + tail, velocity, preset: this.preset })
      }
      // 踏板共鸣：踩下时给八度/十二度极轻的共振（真实钢琴未制音的弦会被邻弦激发）。
      // 只在**中强奏**时启用：弱奏也铺共鸣会让旋律线糊成一片，反而失去"克莱德曼式"的清晰。
      // 采样音源下**关闭**这条人工共鸣：Salamander 是整台琴实录，踏板共鸣本来就录在素材里，
      // 再叠一层合成共鸣 = 同一份泛音叠加两次，听感发浑。
      if (
        this.resonanceEnabled &&
        !this.samples.available &&
        this.pedalDown &&
        this.pedalDepth >= 0.6 &&
        velocity >= 0.45
      ) {
        for (const [semi, amp] of [[12, 0.05], [19, 0.026]] as Array<[number, number]>) {
          const rm = m + semi
          if (rm > 108) continue
          if (this.engine.isSounding?.(rm)) continue
          this.engine.noteOn(rm, {
            when: when + 0.008,
            duration: dur * 1.4,
            velocity: Math.min(0.16, velocity * amp * this.pedalDepth),
            preset: 'soft',
          })
        }
      }
    }
    this.cb.onNote?.(note.midi, velocity, note)
  }

  /* ────────── 播放控制 ────────── */

  /** 从指定拍开始播放（默认从曲首——含弱起） */
  play(fromBeat?: number) {
    if (!this.score) return
    const from = fromBeat ?? this.score.startBeat
    void this.engine.unlock()
    this.engine.setMasterVolume(this.volume)
    this.engine.setReverb(this.reverb)
    // 有真实采样就切到"采样染色"（不进音板 IR），否则维持合成染色
    this.engine.setVoiceSource(this.samples.available ? 'sample' : 'synth')
    this.samples.setPaused(false)
    this.clearTimers()

    this.pedalPoints = this.pedalEnabled ? this.buildPedalPoints(this.score.pedals) : []
    this.running = true
    this.paused = false
    this.finished = false
    this.startBeat = from
    this.audioStart = this.engine.currentTime + 0.12
    this.cursor = this.indexAtBeat(from)
    this.rebuildPedalCursor(from)
    this.pausedBeat = from

    this.tick()
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
    this.raf = requestAnimationFrame(() => this.rafLoop())
    this.emit(true)
  }

  /** 暂停：记住当前拍，静音并撤销未来音符 */
  pause() {
    if (!this.running || this.paused) return
    this.pausedBeat = this.currentBeat()
    this.paused = true
    this.clearTimers()
    const now = this.engine.currentTime
    this.engine.cancelFuture(now + 0.02)
    this.engine.allNotesOff()
    this.samples.allNotesOff()
    this.samples.setPaused(true)
    this.setPedal(false, 0)
    this.emit(true)
  }

  /** 继续：从暂停拍接着演奏 */
  resume() {
    if (!this.running || !this.paused) return
    void this.engine.unlock()
    this.engine.setMasterVolume(this.volume)
    this.samples.setPaused(false)
    this.paused = false
    this.startBeat = this.pausedBeat
    this.audioStart = this.engine.currentTime + 0.1
    this.cursor = this.indexAtBeat(this.pausedBeat)
    this.rebuildPedalCursor(this.pausedBeat)
    this.tick()
    this.timer = window.setInterval(() => this.tick(), TICK_MS)
    this.raf = requestAnimationFrame(() => this.rafLoop())
    this.emit(true)
  }

  toggle() {
    if (!this.running) this.play()
    else if (this.paused) this.resume()
    else this.pause()
  }

  stop() {
    this.clearTimers()
    this.running = false
    this.paused = false
    this.finished = false
    this.cursor = 0
    this.pedCursor = 0
    this.pausedBeat = this.score?.startBeat ?? 0
    this.startBeat = this.score?.startBeat ?? 0
    const now = this.engine.currentTime
    this.engine.cancelFuture(now)
    this.engine.allNotesOff()
    this.samples.allNotesOff()
    this.setPedal(false, 0)
    this.emit(true)
  }

  /** 跳转到指定拍（播放中即时跳转，暂停时只移动游标） */
  seekBeat(beat: number) {
    if (!this.score) return
    const target = Math.max(this.score.startBeat, Math.min(beat, this.score.totalBeats))
    if (!this.running) {
      this.pausedBeat = target
      this.emit(true)
      return
    }
    const now = this.engine.currentTime
    this.engine.cancelFuture(now + 0.02)
    this.engine.allNotesOff()
    this.samples.allNotesOff()
    this.setPedal(false, 0)
    this.startBeat = target
    this.audioStart = now + 0.08
    this.cursor = this.indexAtBeat(target)
    this.rebuildPedalCursor(target)
    this.pausedBeat = target
    if (this.paused) {
      this.emit(true)
    } else {
      this.finished = false
      this.tick()
      this.emit(true)
    }
  }

  /** 按进度 0..1 跳转（0 = 曲首弱起，1 = 曲末） */
  seekProgress(p: number) {
    if (!this.score) return
    const s = this.score
    this.seekBeat(s.startBeat + Math.max(0, Math.min(1, p)) * s.spanBeats)
  }

  private clearTimers() {
    if (this.timer !== null) {
      window.clearInterval(this.timer)
      this.timer = null
    }
    if (this.raf !== null) {
      cancelAnimationFrame(this.raf)
      this.raf = null
    }
  }

  /* ────────── 调度与视觉循环 ────────── */

  private tick() {
    if (!this.score || !this.running || this.paused) return
    const now = this.engine.currentTime
    const notes = this.score.notes

    // ① 音符：把未来 LOOKAHEAD 内的排进音频时钟
    while (this.cursor < notes.length) {
      const n = notes[this.cursor]
      const when = this.beatToAudio(n.beat)
      if (when > now + LOOKAHEAD_S) break
      this.fire(n, Math.max(when, now + 0.004))
      this.cursor++
    }

    // ② 踏板：到点即切换（25ms 粒度对踏板足够）
    while (this.pedCursor < this.pedalPoints.length) {
      const p = this.pedalPoints[this.pedCursor]
      const at = this.beatToAudio(p.beat)
      if (at > now + 0.02) break
      this.setPedal(p.down, p.depth)
      this.pedCursor++
    }

    // ③ 结束判定：全部音符已排完 + 尾音走完
    const last = notes[notes.length - 1]
    const endAt = this.beatToAudio(last.beat + last.durBeats)
    if (this.cursor >= notes.length && now > endAt + TAIL_S) {
      this.finish()
    }

    // ④ 采样音源状态节流上报（每 1.5s）
    if (this.samples.available && now - this.lastSampleReport > 1.5) {
      this.lastSampleReport = now
      this.cb.onSampleStats?.()
    }
  }

  private rafLoop() {
    if (!this.running) return
    this.emit(false)
    this.raf = requestAnimationFrame(() => this.rafLoop())
  }

  private finish() {
    this.clearTimers()
    this.running = false
    this.paused = false
    this.finished = true
    this.setPedal(false, 0)
    this.emit(true)
    this.cb.onComplete?.()
  }

  /** 当前发声中的音（供琴键动画） */
  private activeNotesAt(beat: number): number[] {
    const notes = this.score?.notes ?? []
    const out: number[] = []
    for (let i = this.indexAtBeat(beat - 1.2); i < notes.length; i++) {
      const n = notes[i]
      if (n.beat > beat) break
      const release = n.beat + n.durBeats + (n.pedalDown ? 0.35 : 0.12)
      if (release > beat) out.push(...n.midis)
    }
    return [...new Set(out)]
  }

  private emit(force: boolean) {
    const nowWall = performance.now()
    if (!force && nowWall - this.lastTickWall < 50) return // ~20fps 足够，避免渲染风暴
    this.lastTickWall = nowWall
    const score = this.score
    if (!score) return
    const beat = this.currentBeat()
    const spb = this.spb
    const time = this.beatToSeconds(beat)
    const duration = (score.spanBeats * 60) / this.bpm
    const idx = Math.max(0, this.indexAtBeat(beat) - 1)
    const cur = score.notes[idx]
    const phrase = score.phrases.find((p) => beat >= p.startBeat && beat <= p.endBeat)
    this.cb.onTick?.({
      playing: this.running && !this.paused,
      paused: this.paused,
      finished: this.finished,
      currentBeat: beat,
      currentTime: time,
      totalBeats: score.totalBeats,
      duration,
      bpm: this.bpm,
      progress: duration > 0 ? Math.min(1, time / duration) : 0,
      pedalDown: this.pedalDown,
      pedalDepth: this.pedalDepth,
      activeNotes: this.activeNotesAt(beat),
      currentMeasure: cur?.measure ?? 0,
      sectionLabel: phrase?.form ?? '',
    })
    void spb
  }

  /** 供 UI 首次渲染用的一份静态快照 */
  peek(): AutoPlaySnapshot {
    const score = this.score
    const duration = score ? (score.spanBeats * 60) / this.bpm : 0
    const beat = this.running ? this.currentBeat() : this.pausedBeat
    const time = this.beatToSeconds(beat)
    return {
      playing: this.running && !this.paused,
      paused: this.paused,
      finished: this.finished,
      currentBeat: beat,
      currentTime: time,
      totalBeats: score?.spanBeats ?? 0,
      duration,
      bpm: this.bpm,
      progress: duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0,
      pedalDown: this.pedalDown,
      pedalDepth: this.pedalDepth,
      activeNotes: [],
      currentMeasure: 0,
      sectionLabel: '',
    }
  }
}

let singleton: AutoPlayEngine | null = null

export function getAutoPlayEngine(): AutoPlayEngine {
  if (!singleton) singleton = new AutoPlayEngine()
  return singleton
}
