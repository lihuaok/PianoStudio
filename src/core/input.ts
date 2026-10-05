/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * input.ts — 弹奏输入采集层
 * 统一四种输入源，输出 PlayedNote[] 供评测引擎使用。
 */

import type { InputSource, PlayedNote } from './evaluator'
import { isBlackKey } from './music'

// ── 电脑键盘 → 音名映射 ─────────────────────────────────────────────────────
/**
 * 标准电脑键盘半音布局（两排 + 一排），覆盖约 2.5 个八度。
 * Z 行 = 基准音区（类似钢琴白键位置）
 */
export const COMPUTER_KEYMAP: Record<string, { offset: number; label: string }> = {
  // 第一排（低音区）
  KeyZ: { offset: 0, label: 'C' },
  KeyS: { offset: 1, label: 'C♯' },
  KeyX: { offset: 2, label: 'D' },
  KeyD: { offset: 3, label: 'D♯' },
  KeyC: { offset: 4, label: 'E' },
  KeyV: { offset: 5, label: 'F' },
  KeyG: { offset: 6, label: 'F♯' },
  KeyB: { offset: 7, label: 'G' },
  KeyH: { offset: 8, label: 'G♯' },
  KeyN: { offset: 9, label: 'A' },
  KeyJ: { offset: 10, label: 'A♯' },
  KeyM: { offset: 11, label: 'B' },
  Comma: { offset: 12, label: 'C+' },
  KeyL: { offset: 13, label: 'C♯+' },
  Period: { offset: 14, label: 'D+' },
  Quote: { offset: 15, label: 'D♯+' },
  Semicolon: { offset: 16, label: 'E+' },
  Slash: { offset: 17, label: 'F+' },
  // 第二排（高音区）
  KeyQ: { offset: 12, label: 'C+' },
  Digit2: { offset: 13, label: 'C♯+' },
  KeyW: { offset: 14, label: 'D+' },
  Digit3: { offset: 15, label: 'D♯+' },
  KeyE: { offset: 16, label: 'E+' },
  KeyR: { offset: 17, label: 'F+' },
  Digit5: { offset: 18, label: 'F♯+' },
  KeyT: { offset: 19, label: 'G+' },
  Digit6: { offset: 20, label: 'G♯+' },
  KeyY: { offset: 21, label: 'A+' },
  Digit7: { offset: 22, label: 'A♯+' },
  KeyU: { offset: 23, label: 'B+' },
  KeyI: { offset: 24, label: 'C++' },
  Digit9: { offset: 25, label: 'C♯++' },
  KeyO: { offset: 26, label: 'D++' },
  Digit0: { offset: 27, label: 'D♯++' },
  KeyP: { offset: 28, label: 'E++' },
}

/** 焦点是否在可输入控件上（此时不应触发弹奏，避免与表单操作冲突） */
function isTypingTarget(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null
  if (!el || !el.tagName) return false
  const tag = el.tagName.toUpperCase()
  return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || el.isContentEditable === true
}

/** KeyboardEvent.code → 键帽显示名 */
function prettyKeyCode(code: string): string {
  return code
    .replace(/^Key/, '')
    .replace(/^Digit/, '')
    .replace('Comma', ',')
    .replace('Period', '.')
    .replace('Semicolon', ';')
    .replace('Quote', "'")
    .replace('Slash', '/')
}

export class ComputerKeyboardInput {
  private pressed = new Map<string, { midi: number; time: number }>()
  private baseMidi: number
  private handler: (notes: PlayedNote[]) => void
  private onDown: (midi: number, velocity: number) => void
  private onUp: (midi: number) => void

  constructor(
    baseMidi: number,
    handlers: {
      onNote: (notes: PlayedNote[]) => void
      onNoteOn?: (midi: number, velocity: number) => void
      onNoteOff?: (midi: number) => void
    },
  ) {
    this.baseMidi = baseMidi
    this.handler = handlers.onNote
    this.onDown = handlers.onNoteOn ?? (() => {})
    this.onUp = handlers.onNoteOff ?? (() => {})
  }

  /**
   * 生成「midi → 键帽名」映射，用于键盘 UI 上的键位提示。
   * 同一 midi 有多个物理键时，Q 行（第二排）优先显示（更常用）。
   */
  static keyLabelsFor(baseMidi: number): Map<number, string> {
    const map = new Map<number, string>()
    // Object.entries 保序：后写覆盖 → 定义在后面的 Q 行优先生效
    for (const [code, def] of Object.entries(COMPUTER_KEYMAP)) {
      map.set(baseMidi + def.offset, prettyKeyCode(code))
    }
    return map
  }

  private keydown = (e: KeyboardEvent) => {
    // 修复：长按 OS 自动重复不再二次触发；修饰键组合（如 Ctrl+P 打印）不拦截
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return
    // 修复：焦点在输入框/滑块/下拉框时不触发弹奏
    if (isTypingTarget(e.target)) return
    const m = COMPUTER_KEYMAP[e.code]
    if (!m) return
    e.preventDefault()
    if (this.pressed.has(e.code)) return
    const midi = this.baseMidi + m.offset
    const time = performance.now() / 1000
    this.pressed.set(e.code, { midi, time })
    this.onDown(midi, 0.7)
  }

  private keyup = (e: KeyboardEvent) => {
    const m = COMPUTER_KEYMAP[e.code]
    if (!m) return
    const rec = this.pressed.get(e.code)
    if (!rec) return
    this.pressed.delete(e.code)
    this.onUp(rec.midi)
    const now = performance.now() / 1000
    this.handler([
      {
        midi: rec.midi,
        time: rec.time,
        duration: Math.max(0.04, now - rec.time),
        velocity: 0.7,
        source: 'computer',
      },
    ])
  }

  /**
   * 修复：窗口失焦（Alt-Tab / 切窗口）后 keyup 会丢失，导致：
   *  a) 音符永久鸣响；b) pressed 记录占用 → 该键位之后再按无声（「按键失灵」）。
   *  失焦时释放全部按住的键。
   */
  private onBlur = () => {
    if (this.pressed.size === 0) return
    const now = performance.now() / 1000
    for (const rec of this.pressed.values()) {
      this.onUp(rec.midi)
      this.handler([
        {
          midi: rec.midi,
          time: rec.time,
          duration: Math.max(0.04, now - rec.time),
          velocity: 0.7,
          source: 'computer',
        },
      ])
    }
    this.pressed.clear()
  }

  attach() {
    window.addEventListener('keydown', this.keydown)
    window.addEventListener('keyup', this.keyup)
    window.addEventListener('blur', this.onBlur)
  }

  detach() {
    window.removeEventListener('keydown', this.keydown)
    window.removeEventListener('keyup', this.keyup)
    window.removeEventListener('blur', this.onBlur)
    // 移除监听时也要清掉按住状态，防止残留卡音
    this.onBlur()
  }
}

// ── Web MIDI ────────────────────────────────────────────────────────────────
export class MidiInput {
  private access: MIDIAccess | null = null
  private activeNotes = new Map<number, { time: number; velocity: number; finger?: number }>()
  private onNote: (notes: PlayedNote[]) => void
  private onNoteOn: (midi: number, velocity: number, finger?: number) => void
  private onNoteOff: (midi: number) => void
  private onStatus: (msg: string, devices: Array<{ id: string; name: string }>) => void
  private startTime = 0

  constructor(handlers: {
    onNote: (notes: PlayedNote[]) => void
    onNoteOn?: (midi: number, velocity: number, finger?: number) => void
    onNoteOff?: (midi: number) => void
    onStatus?: (msg: string, devices: Array<{ id: string; name: string }>) => void
  }) {
    this.onNote = handlers.onNote
    this.onNoteOn = handlers.onNoteOn ?? (() => {})
    this.onNoteOff = handlers.onNoteOff ?? (() => {})
    this.onStatus = handlers.onStatus ?? (() => {})
  }

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && 'requestMIDIAccess' in navigator
  }

  async connect(): Promise<boolean> {
    if (!MidiInput.supported) {
      this.onStatus('当前浏览器不支持 Web MIDI', [])
      return false
    }
    try {
      this.access = await navigator.requestMIDIAccess()
      this.startTime = performance.now() / 1000
      const devices: Array<{ id: string; name: string }> = []
      this.access.inputs.forEach((input) => {
        input.onmidimessage = (e) => this.handleMessage(e)
        devices.push({ id: input.id, name: input.name ?? 'MIDI 设备' })
      })
      this.access.onstatechange = () => {
        const list: Array<{ id: string; name: string }> = []
        this.access?.inputs.forEach((i) => list.push({ id: i.id, name: i.name ?? 'MIDI 设备' }))
        this.onStatus(list.length ? `已连接 ${list.length} 个设备` : '未检测到 MIDI 设备', list)
      }
      if (devices.length === 0) {
        this.onStatus('未检测到 MIDI 设备，请连接电钢琴后重试', [])
        return false
      }
      this.onStatus(`已连接：${devices.map((d) => d.name).join('、')}`, devices)
      return true
    } catch (e) {
      this.onStatus(`MIDI 连接被拒绝：${e instanceof Error ? e.message : e}`, [])
      return false
    }
  }

  private handleMessage(e: MIDIMessageEvent) {
    const data = e.data
    if (!data || data.length < 2) return
    const status = data[0] & 0xf0
    const note = data[1]
    const vel = data.length > 2 ? data[2] : 0
    const now = performance.now() / 1000 - this.startTime

    if (status === 0x90 && vel > 0) {
      this.activeNotes.set(note, { time: now, velocity: vel / 127 })
      this.onNoteOn(note, vel / 127)
    } else if (status === 0x80 || (status === 0x90 && vel === 0)) {
      const rec = this.activeNotes.get(note)
      if (!rec) return
      this.activeNotes.delete(note)
      this.onNoteOff(note)
      this.onNote([
        {
          midi: note,
          time: rec.time,
          duration: Math.max(0.03, now - rec.time),
          velocity: rec.velocity,
          source: 'midi',
        },
      ])
    }
  }

  disconnect() {
    this.activeNotes.clear()
  }
}

// ── 麦克风（YIN 基频检测） ──────────────────────────────────────────────────
/**
 * YIN 基频检测算法（de Cheveigné & Kawahara, 2002）
 * 步骤：差分函数 → 累积均值归一化 → 绝对阈值 → 抛物线插值
 */
export function yinPitchDetection(
  buffer: Float32Array<ArrayBufferLike>,
  sampleRate: number,
  threshold = 0.12,
): { freq: number; clarity: number } {
  const N = buffer.length
  const half = Math.floor(N / 2)
  const diff = new Float32Array(half)
  const cmnd = new Float32Array(half)

  // 1. 差分函数
  for (let tau = 0; tau < half; tau++) {
    let sum = 0
    for (let i = 0; i < half; i++) {
      const delta = buffer[i] - buffer[i + tau]
      sum += delta * delta
    }
    diff[tau] = sum
  }

  // 2. 累积均值归一化
  cmnd[0] = 1
  let running = 0
  for (let tau = 1; tau < half; tau++) {
    running += diff[tau]
    cmnd[tau] = running === 0 ? 1 : (diff[tau] * tau) / running
  }

  // 3. 绝对阈值搜索
  let tauEstimate = -1
  for (let tau = 2; tau < half; tau++) {
    if (cmnd[tau] < threshold) {
      // 找到局部极小
      while (tau + 1 < half && cmnd[tau + 1] < cmnd[tau]) tau++
      tauEstimate = tau
      break
    }
  }
  if (tauEstimate === -1) return { freq: 0, clarity: 0 }

  // 4. 抛物线插值
  const x0 = tauEstimate < 1 ? tauEstimate : tauEstimate - 1
  const x2 = tauEstimate + 1 < half ? tauEstimate + 1 : tauEstimate
  let betterTau: number
  if (x0 === tauEstimate) betterTau = cmnd[tauEstimate] <= cmnd[x2] ? tauEstimate : x2
  else if (x2 === tauEstimate) betterTau = cmnd[tauEstimate] <= cmnd[x0] ? tauEstimate : x0
  else {
    const s0 = cmnd[x0]
    const s1 = cmnd[tauEstimate]
    const s2 = cmnd[x2]
    const denom = 2 * (2 * s1 - s2 - s0)
    betterTau = denom === 0 ? tauEstimate : tauEstimate + (s2 - s0) / denom
  }

  const freq = sampleRate / betterTau
  const clarity = Math.max(0, Math.min(1, 1 - cmnd[tauEstimate]))
  return { freq, clarity }
}

export function freqToMidi(freq: number): number {
  return 69 + 12 * Math.log2(freq / 440)
}

export class MicrophoneInput {
  private ctx: AudioContext | null = null
  private analyser: AnalyserNode | null = null
  private stream: MediaStream | null = null
  private buffer: Float32Array<ArrayBuffer> = new Float32Array(new ArrayBuffer(2048 * 4))
  private running = false
  private timer: number | null = null

  private onNote: (notes: PlayedNote[]) => void
  private onNoteOn: (midi: number, velocity: number) => void
  private onNoteOff: (midi: number) => void
  private onLevel: (level: number, freq: number, midi: number | null) => void
  private onStatus: (msg: string) => void

  private currentMidi: number | null = null
  private noteStart = 0
  private peakVelocity = 0
  private startTime = 0
  private silenceFrames = 0

  constructor(handlers: {
    onNote: (notes: PlayedNote[]) => void
    onNoteOn?: (midi: number, velocity: number) => void
    onNoteOff?: (midi: number) => void
    onLevel?: (level: number, freq: number, midi: number | null) => void
    onStatus?: (msg: string) => void
  }) {
    this.onNote = handlers.onNote
    this.onNoteOn = handlers.onNoteOn ?? (() => {})
    this.onNoteOff = handlers.onNoteOff ?? (() => {})
    this.onLevel = handlers.onLevel ?? (() => {})
    this.onStatus = handlers.onStatus ?? (() => {})
  }

  static get supported(): boolean {
    return typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia
  }

  async start(): Promise<boolean> {
    if (!MicrophoneInput.supported) {
      this.onStatus('当前环境不支持麦克风采集')
      return false
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      this.ctx = new AudioContext()
      const src = this.ctx.createMediaStreamSource(this.stream)
      this.analyser = this.ctx.createAnalyser()
      this.analyser.fftSize = 4096
      this.analyser.smoothingTimeConstant = 0.2
      src.connect(this.analyser)
      this.buffer = new Float32Array(new ArrayBuffer(this.analyser.fftSize * 4))
      this.startTime = performance.now() / 1000
      this.running = true
      this.loop()
      this.onStatus('麦克风已开启，正在监听…')
      return true
    } catch (e) {
      this.onStatus(`无法访问麦克风：${e instanceof Error ? e.message : e}`)
      return false
    }
  }

  private loop = () => {
    if (!this.running || !this.analyser) return
    this.analyser.getFloatTimeDomainData(this.buffer)

    // RMS 能量
    let sum = 0
    for (let i = 0; i < this.buffer.length; i++) sum += this.buffer[i] * this.buffer[i]
    const rms = Math.sqrt(sum / this.buffer.length)
    const level = Math.min(1, rms * 6)

    const now = performance.now() / 1000 - this.startTime
    const { freq, clarity } = level > 0.012
      ? yinPitchDetection(this.buffer, this.ctx!.sampleRate, 0.15)
      : { freq: 0, clarity: 0 }

    let midi: number | null = null
    if (freq > 40 && freq < 2200 && clarity > 0.6) {
      const m = freqToMidi(freq)
      if (m > 20 && m < 108) midi = Math.round(m)
    }

    this.onLevel(level, freq, midi)

    const ONSET = 0.055
    const OFFSET = 0.028

    if (midi !== null && level > ONSET) {
      if (this.currentMidi === null) {
        // 新音开始
        this.currentMidi = midi
        this.noteStart = now
        this.peakVelocity = level
        this.silenceFrames = 0
        this.onNoteOn(midi, level)
      } else if (midi === this.currentMidi) {
        this.peakVelocity = Math.max(this.peakVelocity, level)
        this.silenceFrames = 0
      } else if (Math.abs(midi - this.currentMidi) === 1 && level > 0.16) {
        // 半音滑音视为同一音的颤音，避免误触发
        this.silenceFrames = 0
      } else {
        // 音高跳变 → 结束旧音，开始新音
        this.endNote(now)
        this.currentMidi = midi
        this.noteStart = now
        this.peakVelocity = level
        this.onNoteOn(midi, level)
      }
    } else if (this.currentMidi !== null) {
      this.silenceFrames++
      if (level < OFFSET || this.silenceFrames > 3) {
        this.endNote(now)
      }
    }

    this.timer = window.setTimeout(this.loop, 22)
  }

  private endNote(now: number) {
    if (this.currentMidi === null) return
    const midi = this.currentMidi
    const dur = Math.max(0.05, now - this.noteStart)
    this.onNote([
      {
        midi,
        time: this.noteStart,
        duration: dur,
        velocity: Math.min(1, this.peakVelocity),
        source: 'mic',
      },
    ])
    this.onNoteOff(midi)
    this.currentMidi = null
    this.silenceFrames = 0
  }

  stop() {
    this.running = false
    if (this.timer !== null) clearTimeout(this.timer)
    this.timer = null
    this.stream?.getTracks().forEach((t) => t.stop())
    this.stream = null
    if (this.ctx) {
      this.ctx.close().catch(() => {})
      this.ctx = null
    }
    this.currentMidi = null
    this.onStatus('麦克风已关闭')
  }
}

/** 可弹奏键盘的音符属性 */
export interface KeySpec {
  midi: number
  isBlack: boolean
  /** 在白键序列中的序号（黑键为其左侧白键的序号） */
  whiteIndex: number
  name: string
}

export function buildKeyboard(lowMidi: number, highMidi: number): { keys: KeySpec[]; whiteCount: number } {
  const keys: KeySpec[] = []
  let whiteIndex = 0
  for (let m = lowMidi; m <= highMidi; m++) {
    const black = isBlackKey(m)
    if (!black) {
      keys.push({ midi: m, isBlack: false, whiteIndex: whiteIndex++, name: `${m % 12 === 0 ? 'C' : ''}${Math.floor(m / 12) - 1}` })
    } else {
      keys.push({ midi: m, isBlack: true, whiteIndex: whiteIndex - 1, name: '' })
    }
  }
  return { keys, whiteCount: whiteIndex }
}

export type { InputSource }
