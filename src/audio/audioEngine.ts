/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * audioEngine.ts — Web Audio 钢琴合成引擎
 *
 * 设计要点：
 *  1. 采样无关：加性/减性合成 + 噪声打击，零外部资源，任何设备都能出声。
 *  2. 拟真包络：击弦瞬态（thump + click 双段）→ 两段自然衰减（无稳态平台）→ 制音器落键。
 *  3. 弦间拍频（unison detune）：真实钢琴每组 2-3 根弦有几音分失谐，慢拍频是"活"音色的核心。
 *  4. 动态亮度：力度改变频谱倾斜——强奏亮、弱奏闷（钢琴表现力的核心）。
 *  5. 琴体共鸣：程序生成的音板 IR（木质共振模式）串联染色 + 大厅混响 send。
 *  6. 共享基础设施：ConvolverNode ×2（音板 + 混响）+ 总线压缩器。
 */

import { midiToFrequency } from '@/core/music'

export interface NoteVoiceOptions {
  /** 力度 0..1 */
  velocity?: number
  /** 起音时间（AudioContext 时间） */
  when?: number
  /** 持音时长（秒）；undefined 表示直到 release() */
  duration?: number
  /** 音色预设 */
  preset?: PianoPreset
  /** 是否走效果总线 */
  effects?: boolean
}

export type PianoPreset = 'grand' | 'bright' | 'soft' | 'music' | 'epiano' | 'warm'

interface PresetProfile {
  /** 合成方式：加性泛音叠加 / FM（电钢琴簧片） */
  kind?: 'additive' | 'fm'
  partials: number[]
  partialGains: number[]
  hammerNoise: number
  hammerDecay: number
  bodyDecay: number
  release: number
  brightness: number
  inharmonicity: number
  detune: number
  /** 弦间失谐（音分）：产生自然拍频 */
  stringDetune: number
  /** 力度→亮度系数：越大则强奏越亮、弱奏越闷 */
  velBrightness: number
  label: string
  /* ── 以下为 2026-10-05 音色改造新增（全部可选，缺省值保证旧预设行为不变）── */
  /** 整体音量系数 */
  level?: number
  /** 起音时间（秒）：过短就是"爆音"的直接来源 */
  attack?: number
  /**
   * 每声部低通截止 = 基频 × toneFactor（≥1）。
   * 这是消除"尖刺感"最关键的一环：真实钢琴的高次泛音本来就弱，
   * 而纯加性合成会把高次泛音原样搬出来，听感就是刀片一样的亮。
   */
  toneFactor?: number
  /** 力度对截止频率的开合程度：0 = 固定，1 = 强奏全开弱奏全合 */
  toneVel?: number
  /** 衰减到该比例后进入延持段（0 = 一直衰减到零） */
  sustainRatio?: number
  /** FM：调制比（整数 → 乐音谐波） */
  fmRatio?: number
  /** FM：调制指数（换算成 Hz 频偏 = 基频 × fmIndex） */
  fmIndex?: number
  /** FM：调制指数衰减到残留值的时间，决定"簧片敲击"的金属感长度 */
  fmIndexDecay?: number
  /** 颤音（ Rhodes 风格的柔和起伏） */
  tremoloRate?: number
  tremoloDepth?: number
  /** 立体声铺开宽度：0 = 单声道居中 */
  stereoWidth?: number
}

export const PRESETS: Record<PianoPreset, PresetProfile> = {
  grand: {
    partials: [1, 2, 3, 4, 5, 6, 7, 8],
    partialGains: [1, 0.52, 0.3, 0.19, 0.13, 0.09, 0.06, 0.04],
    hammerNoise: 0.16,
    hammerDecay: 0.035,
    bodyDecay: 1.35,
    release: 0.42,
    brightness: 1,
    inharmonicity: 0.00042,
    detune: 3.2,
    stringDetune: 1.2,
    velBrightness: 1.1,
    label: '三角钢琴',
  },
  bright: {
    partials: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
    partialGains: [1, 0.62, 0.4, 0.28, 0.2, 0.15, 0.11, 0.08, 0.055, 0.04],
    hammerNoise: 0.24,
    hammerDecay: 0.028,
    bodyDecay: 1.1,
    release: 0.34,
    brightness: 1.24,
    inharmonicity: 0.0006,
    detune: 4.6,
    stringDetune: 1.6,
    velBrightness: 1.5,
    label: '明亮（现代）',
  },
  soft: {
    partials: [1, 2, 3, 4, 5],
    partialGains: [1, 0.3, 0.14, 0.07, 0.035],
    hammerNoise: 0.05,
    hammerDecay: 0.05,
    bodyDecay: 1.9,
    release: 0.6,
    brightness: 0.74,
    inharmonicity: 0.0003,
    detune: 2.1,
    stringDetune: 0.7,
    velBrightness: 0.55,
    label: '柔和（弱音踏板）',
  },
  music: {
    partials: [1, 2, 3, 4, 5, 6, 7],
    partialGains: [1, 0.46, 0.26, 0.15, 0.1, 0.06, 0.045],
    hammerNoise: 0.1,
    hammerDecay: 0.032,
    bodyDecay: 1.6,
    release: 0.5,
    brightness: 0.94,
    inharmonicity: 0.0004,
    detune: 2.6,
    stringDetune: 1.0,
    velBrightness: 0.95,
    toneFactor: 8.5,
    toneVel: 0.5,
    sustainRatio: 0.06,
    level: 1,
    attack: 0.004,
    stereoWidth: 0.35,
    label: '音乐厅平衡',
  },
  /**
   * 电钢琴（Rhodes 风格）—— 本次音色问题的主答案。
   *
   * 为什么不再用纯加性：加性合成把每个泛音**等比例**堆出来，高次泛音与基音
   * 同步衰减，听感就是硬、尖、像电子琴。真实电钢琴是「簧片 + 拾音器」：
   * 起音瞬间频谱极宽（金属敲击），随后只有基频在木箱里长时间延留。
   * FM（调制比 1:1、调制指数快速衰减）天然复现这个「宽→窄」的谱形收缩，
   * 再串一个随力度开合的低通把残余的刺耳高频压掉，就是克莱德曼那种圆润的音。
   */
  epiano: {
    kind: 'fm',
    partials: [1],
    partialGains: [1],
    fmRatio: 1,
    fmIndex: 2.4,
    fmIndexDecay: 0.55,
    hammerNoise: 0.025,
    hammerDecay: 0.05,
    bodyDecay: 2.6,
    release: 0.75,
    brightness: 1,
    inharmonicity: 0,
    detune: 1.1,
    stringDetune: 0.6,
    velBrightness: 0.8,
    level: 1.05,
    attack: 0.009,
    toneFactor: 6.2,
    toneVel: 0.75,
    sustainRatio: 0.3,
    tremoloRate: 4.6,
    tremoloDepth: 0.05,
    stereoWidth: 0.5,
    label: '电钢琴（柔和）',
  },
  /** 柔和大钢琴：加性但砍掉高次泛音 + 慢起音 + 无 click，比 grand 更"暖" */
  warm: {
    partials: [1, 2, 3, 4],
    partialGains: [1, 0.34, 0.13, 0.05],
    hammerNoise: 0.035,
    hammerDecay: 0.055,
    bodyDecay: 2.1,
    release: 0.62,
    brightness: 0.82,
    inharmonicity: 0.0003,
    detune: 2.2,
    stringDetune: 0.8,
    velBrightness: 0.7,
    level: 1.02,
    attack: 0.008,
    toneFactor: 5.6,
    toneVel: 0.65,
    sustainRatio: 0.16,
    stereoWidth: 0.4,
    label: '柔和大钢琴',
  },
}

/** 预设字段缺省值（老预设没写新字段时兜底，保证行为不变） */
const P = {
  kind: 'additive' as 'additive' | 'fm',
  level: 1,
  attack: 0.004,
  toneFactor: 9,
  toneVel: 0.5,
  sustainRatio: 0.06,
  fmRatio: 1,
  fmIndex: 2,
  fmIndexDecay: 0.4,
  tremoloRate: 0,
  tremoloDepth: 0,
  stereoWidth: 0.35,
}

/**
 * tanh 软削波曲线。
 * 输入超过 ±1 时不是被硬切（方角 = 大量奇次谐波 = "爆音/沙哑"），
 * 而是连续地压向 ±0.8 附近（软拐点），听感是"变厚"而不是"炸"。
 */
function makeSoftClipCurve(samples = 4096): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(new ArrayBuffer(samples * 4))
  const k = 1.9
  for (let i = 0; i < samples; i++) {
    const x = (i / (samples - 1)) * 2 - 1 // -1..1
    curve[i] = Math.tanh(k * x) / Math.tanh(k)
  }
  return curve
}

interface LiveVoice {
  midi: number
  oscillators: OscillatorNode[]
  gains: GainNode[]
  master: GainNode
  released: boolean
  startTime: number
  preset: PianoPreset
}

export class AudioEngine {
  readonly ctx: AudioContext
  private masterGain!: GainNode
  private dryBus!: GainNode
  private wetBus!: GainNode
  private convolver!: ConvolverNode
  private sbConvolver!: ConvolverNode
  private sbGain!: GainNode
  private dryTrim!: GainNode
  private toneShelf!: BiquadFilterNode
  private softClip!: WaveShaperNode
  private clipMakeup!: GainNode
  private compressor!: DynamicsCompressorNode
  private wetLevel!: GainNode
  private live = new Map<number, LiveVoice>()
  private metronomeGain!: GainNode
  private noiseBuffer: AudioBuffer | null = null
  private _sustainPedal = false
  private sustainedVoices = new Set<number>()
  private unlocked = false

  constructor() {
    const Ctor: typeof AudioContext =
      (window as any).AudioContext || (window as any).webkitAudioContext || ((globalThis as any).AudioContext as any)
    this.ctx = new Ctor({ latencyHint: 'interactive' })
    this.buildGraph()
  }

  /** iOS/Safari 需要用户手势解锁 */
  async unlock(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume()
    }
    this.unlocked = true
  }

  get ready(): boolean {
    return this.unlocked && this.ctx.state === 'running'
  }

  get currentTime(): number {
    return this.ctx.currentTime
  }

  private buildGraph() {
    const ctx = this.ctx
    this.masterGain = ctx.createGain()
    this.masterGain.gain.value = 0.9

    this.compressor = ctx.createDynamicsCompressor()
    this.compressor.threshold.value = -10
    this.compressor.knee.value = 26
    this.compressor.ratio.value = 2.2
    this.compressor.attack.value = 0.012
    this.compressor.release.value = 0.26

    /**
     * 总音色链路最后两级（本次新增，专门解决"刺耳/爆音/削波"）：
     *   ① 高频搁架：4.2kHz 以上衰减 5dB —— 削掉纯合成最惹人烦的那层亮片，
     *      保留 2~4kHz 的"存在感"，所以不会变闷，只会变圆润。
     *   ② tanh 软削波：和弦叠加或强奏超过 0dBFS 时做连续饱和
     *      （电子管的软拐点），而不是让波形被硬切出方角 —— 那是"爆音"的来源。
     *      后面跟一级补偿增益把被压缩的响度补回来。
     */
    this.toneShelf = ctx.createBiquadFilter()
    this.toneShelf.type = 'highshelf'
    this.toneShelf.frequency.value = 4200
    this.toneShelf.gain.value = -5

    this.softClip = ctx.createWaveShaper()
    this.softClip.curve = makeSoftClipCurve()
    this.softClip.oversample = '4x'
    // 削波前的固定补偿（不是"削完再放大"，那样会重新冲破 1.0）
    this.clipMakeup = ctx.createGain()
    this.clipMakeup.gain.value = 1.12

    this.dryBus = ctx.createGain()
    this.dryBus.gain.value = 0.86

    // 琴体共鸣：音板 IR 串联染色（木质共振模式），旁路少量干声保留瞬态
    this.sbConvolver = ctx.createConvolver()
    this.sbConvolver.buffer = this.makeSoundboardIR()
    this.sbGain = ctx.createGain()
    this.sbGain.gain.value = 0.85
    this.dryTrim = ctx.createGain()
    this.dryTrim.gain.value = 0.2

    this.convolver = ctx.createConvolver()
    this.convolver.buffer = this.makeImpulseResponse(2.4, 2.1)
    this.wetBus = ctx.createGain()
    this.wetBus.gain.value = 1
    this.wetLevel = ctx.createGain()
    this.wetLevel.gain.value = 0.2

    this.metronomeGain = ctx.createGain()
    this.metronomeGain.gain.value = 0.5

    // 路由：voice → dryBus → [音板 IR（染色）+ 干声旁路] → compressor → master
    //                → wetBus(混响 send) → wetLevel → compressor
    this.dryBus.connect(this.sbConvolver)
    this.sbConvolver.connect(this.sbGain)
    this.sbGain.connect(this.compressor)
    this.dryBus.connect(this.dryTrim)
    this.dryTrim.connect(this.compressor)
    this.wetBus.connect(this.convolver)
    this.convolver.connect(this.wetLevel)
    this.wetLevel.connect(this.compressor)
    /**
     * 末级顺序很关键：**音量必须在软削波之前**。
     * WaveShaper 的曲线只覆盖输入 [-1,1]，超出范围会被钳到曲线端点 = 硬削波。
     * 如果把音量/补偿增益放在削波之后，总线就能冲过 1.0（实测 1.096，6 次满幅），
     * 软削波形同虚设。放在之前则表现为"越响越饱和"，这正是软限幅该有的行为。
     */
    this.compressor.connect(this.toneShelf)
    this.toneShelf.connect(this.clipMakeup)
    this.clipMakeup.connect(this.masterGain)
    this.masterGain.connect(this.softClip)
    this.softClip.connect(ctx.destination)
    this.metronomeGain.connect(this.softClip)
  }

  /**
   * 程序生成厅堂混响脉冲响应。
   *
   * 旧版是"指数衰减白噪声 + 几个拍点"，听感是一层没有形状的雾，钢琴泛音被糊掉。
   * 真实厅堂有三个可听特征，这里逐一补回来：
   *  ① **预延迟**：直达声之后 18ms 才有第一波反射（房间尺度）。没有它，混响会"贴脸"；
   *  ② **密度递增**：早期反射稀疏（能听出墙面），之后迅速变密成为混响尾巴；
   *  ③ **频率相关衰减**：高频被空气与软质表面吸得更快，尾巴越往后越暗 ——
   *     这是"温暖"而不是"刺"的关键，也是钢琴录音听起来厚的真正原因。
   * 左右声道使用不同反射图案与轻微不同的衰减，得到真实宽度而非单声道复制。
   */
  private makeImpulseResponse(seconds: number, decay: number): AudioBuffer {
    const rate = this.ctx.sampleRate
    const length = Math.floor(rate * seconds)
    const buffer = this.ctx.createBuffer(2, length, rate)
    const preDelay = Math.floor(rate * 0.018)
    const tapsA = [0.019, 0.031, 0.047, 0.063, 0.081, 0.099]
    const tapsB = [0.023, 0.037, 0.043, 0.071, 0.089, 0.107]
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch)
      const seed = ch === 0 ? 1 : 0.93
      let lp = 0 // 时变单极点低通的状态
      for (let i = 0; i < length; i++) {
        if (i < preDelay) {
          data[i] = 0
          continue
        }
        const t = (i - preDelay) / (length - preDelay)
        // ③ 高频随时间衰减：等效截止从 ~9kHz 一路降到 ~1.2kHz
        const cut = 9000 * Math.pow(0.14, t)
        const a = Math.exp((-2 * Math.PI * cut) / rate)
        const noise = Math.random() * 2 - 1
        lp = lp * a + noise * (1 - a)
        // ② 前 6% 的密度渐入，模拟"从稀疏反射到扩散场"
        const buildup = Math.min(1, t / 0.06)
        data[i] = lp * Math.pow(1 - t, decay) * buildup * seed
      }
      // ① 早期反射：离散拍点，左右图案不同 → 立体声宽度
      const taps = ch === 0 ? tapsA : tapsB
      taps.forEach((tap, k) => {
        const idx = preDelay + Math.floor(tap * rate)
        if (idx < length) data[idx] += (0.5 - k * 0.06) * (k % 2 ? -1 : 1) * seed
      })
    }
    return buffer
  }

  /**
   * 告诉总线"当前是什么音源在发声"，据此切换染色策略。
   *
   *  · 'synth'  —— 纯合成：需要音板 IR 把振荡器"塞进木头里"，并多削一点高频去掉刀片感。
   *  · 'sample' —— 真实采样：录音里已经包含琴体与房间。再串一次音板 IR 就是**双重染色**，
   *                声音会发闷发糊（"隔着被子弹"）。所以主通路走干声、音板几乎旁路，
   *                高频只做极轻微处理，让采样原样过去。
   *
   * 缺省仍是 'synth'，因此其它页面（练习、评测）的行为完全不变。
   */
  setVoiceSource(kind: 'synth' | 'sample') {
    const t = this.ctx.currentTime
    const ramp = (p: AudioParam, v: number) => p.setTargetAtTime(v, t, 0.08)
    if (kind === 'sample') {
      ramp(this.dryTrim.gain, 0.95)
      ramp(this.sbGain.gain, 0.14)
      ramp(this.toneShelf.gain, -1.5)
    } else {
      ramp(this.dryTrim.gain, 0.2)
      ramp(this.sbGain.gain, 0.85)
      ramp(this.toneShelf.gain, -5)
    }
  }

  /**
   * 程序生成音板（soundboard）脉冲响应：
   * 直达脉冲 + 若干木质共振模式（钢琴音板的特征共振峰 ~95/165/310/620/1250 Hz）。
   * 给干声加"琴体感"，消除纯振荡器的合成味。
   */
  private makeSoundboardIR(): AudioBuffer {
    const rate = this.ctx.sampleRate
    const dur = 0.28
    const length = Math.floor(rate * dur)
    const buffer = this.ctx.createBuffer(2, length, rate)
    const modes: Array<[freq: number, amp: number, decay: number]> = [
      [95, 0.5, 0.09],
      [165, 0.38, 0.07],
      [310, 0.3, 0.05],
      [620, 0.22, 0.035],
      [1250, 0.16, 0.022],
    ]
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch)
      data[0] = 1 // 直达
      for (const [f, a, dec] of modes) {
        const w = (2 * Math.PI * f) / rate
        const n = Math.min(length, Math.floor(rate * dec * 8))
        const chScale = ch === 0 ? 1 : 0.88
        for (let i = 1; i < n; i++) {
          data[i] += a * chScale * Math.exp(-i / (dec * rate)) * Math.sin(w * i)
        }
      }
    }
    return buffer
  }

  private getNoiseBuffer(): AudioBuffer {
    if (!this.noiseBuffer) {
      const rate = this.ctx.sampleRate
      const len = Math.floor(rate * 0.5)
      const buf = this.ctx.createBuffer(1, len, rate)
      const d = buf.getChannelData(0)
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1
      this.noiseBuffer = buf
    }
    return this.noiseBuffer
  }

  setMasterVolume(v: number) {
    this.masterGain.gain.setTargetAtTime(Math.max(0, Math.min(1.2, v)), this.ctx.currentTime, 0.02)
  }

  setReverb(amount: number) {
    this.wetLevel.gain.setTargetAtTime(Math.max(0, Math.min(1, amount)), this.ctx.currentTime, 0.05)
  }

  setMetronomeVolume(v: number) {
    this.metronomeGain.gain.setTargetAtTime(Math.max(0, Math.min(1, v)), this.ctx.currentTime, 0.02)
  }

  get metronomeOutput(): GainNode {
    return this.metronomeGain
  }

  /** 供外部音源（如采样引擎）注入干声总线 */
  get dryInput(): GainNode {
    return this.dryBus
  }

  /** 供外部音源注入混响 send 总线 */
  get wetInput(): GainNode {
    return this.wetBus
  }

  /** 该音高当前是否仍在发声（自动演奏用来避免共鸣音盖掉真实音） */
  isSounding(midi: number): boolean {
    const v = this.live.get(midi)
    return !!v && !v.released
  }

  /**
   * 最终输出节点（软限幅之后、destination 之前）。
   * 自动化音质检测在这里取样才代表"真正送进声卡的信号"——
   * masterGain 之后还有软削波，在那里测到的峰值可以 >1，那是设计如此。
   */
  get output(): AudioNode {
    return this.softClip
  }

  /**
   * 撤销所有「已排在 startAfter 之后、尚未真正发声」的音。
   * 自动演奏实时变速 / 进度跳转时用：Web Audio 已排入未来的音符无法自动撤回，
   * 必须显式取消，否则改速度后会先冒出一串旧速度的音。
   */
  cancelFuture(startAfter: number) {
    for (const [midi, voice] of Array.from(this.live.entries())) {
      if (voice.startTime > startAfter) {
        this.killVoice(voice, this.ctx.currentTime, 0.03)
        this.live.delete(midi)
      }
    }
  }

  get sustainPedalDown(): boolean {
    return this._sustainPedal
  }

  setSustainPedal(down: boolean) {
    this._sustainPedal = down
    if (!down) {
      for (const midi of Array.from(this.sustainedVoices)) {
        this.release(midi)
      }
      this.sustainedVoices.clear()
    }
  }

  /**
   * 触发一个音。返回 MIDI 号以便调用方 release。
   * 同一音高重复触发会先快速释放旧声部（模拟钢琴重槌），避免叠加卡顿。
   */
  noteOn(midi: number, opts: NoteVoiceOptions = {}): number {
    const { velocity = 0.72, when, duration, preset = 'grand', effects = true } = opts
    const t0 = when ?? this.ctx.currentTime + 0.001
    const profile = PRESETS[preset]

    const existing = this.live.get(midi)
    if (existing && !existing.released) {
      this.killVoice(existing, t0, profile.release)
      this.live.delete(midi)
    }

    const freq = midiToFrequency(midi)
    // 低音区共鸣更强、衰减更长；高音区亮度更高
    const pitchFactor = Math.max(0.35, Math.min(1.6, 1.5 - midi / 96))
    const vel = Math.max(0.02, Math.min(1, velocity))
    const kind = profile.kind ?? P.kind
    const attack = profile.attack ?? P.attack
    const sustainRatio = profile.sustainRatio ?? P.sustainRatio

    const master = this.ctx.createGain()
    /**
     * 干净的 ADSR（四段），并且**只在 master 上做一次**：
     * 旧实现把 peak 同时乘进了 master 和每个泛音的归一化振幅里（双重缩放），
     * 导致力度与响度的关系难以预测，强奏时容易冲过头触发硬削波。
     * 现在泛音振幅归一化到 Σ=1，响度完全由 master 的 ADSR 决定。
     */
    const peakVel = 0.32 * Math.pow(vel, 1.2) * pitchFactor * (profile.level ?? P.level)
    master.gain.setValueAtTime(0, t0)
    // A：线性起音（不用 setTargetAtTime，避免起始那一帧的突变 = 爆音）
    master.gain.linearRampToValueAtTime(peakVel, t0 + attack)
    if (sustainRatio > 0) {
      // D：指数衰减到延持电平
      master.gain.exponentialRampToValueAtTime(
        Math.max(0.0002, peakVel * sustainRatio),
        t0 + attack + Math.max(0.05, profile.bodyDecay),
      )
    } else {
      master.gain.exponentialRampToValueAtTime(0.0002, t0 + attack + profile.bodyDecay)
    }
    // R：到时松键，制音器落下（真正的第四段）
    if (duration !== undefined) {
      const rel = profile.release
      const offAt = t0 + Math.max(attack + 0.02, duration)
      master.gain.setTargetAtTime(0.0001, offAt, rel / 3)
    }

    // 每声部低通：截止 = 基频 × toneFactor，并随力度开合（强奏稍亮，弱奏很柔）
    const tone = this.ctx.createBiquadFilter()
    tone.type = 'lowpass'
    tone.Q.value = 0.5
    const tf = profile.toneFactor ?? P.toneFactor
    const tv = profile.toneVel ?? P.toneVel
    const cutoff = Math.min(freq * tf * (1 - tv + tv * (0.55 + 0.75 * vel)), 18000)
    tone.frequency.setValueAtTime(Math.max(220, cutoff), t0)

    const stereo = this.ctx.createStereoPanner?.()
    if (stereo) {
      const w = profile.stereoWidth ?? P.stereoWidth
      stereo.pan.value = Math.max(-1, Math.min(1, ((midi - 64) / 44) * w * 0.5))
    }

    const oscillators: OscillatorNode[] = []
    const gains: GainNode[] = []
    /** 泛音输出统一汇总到 bus（增益恒为归一化后的权重） */
    const bus = this.ctx.createGain()
    bus.gain.value = 1

    if (kind === 'fm') {
      // ── FM（Rhodes 簧片）──────────────────────────────────────────────────
      // 载波 + 同频调制器：起音频谱极宽（金属感），调制指数很快衰减后
      // 只剩近乎纯正的基频延留 —— 电钢琴"柔而有芯"的全部秘密就在这里。
      const ratio = profile.fmRatio ?? P.fmRatio
      const index = profile.fmIndex ?? P.fmIndex
      const idxDecay = profile.fmIndexDecay ?? P.fmIndexDecay

      const carrier = this.ctx.createOscillator()
      carrier.type = 'sine'
      carrier.frequency.setValueAtTime(freq, t0)

      const modulator = this.ctx.createOscillator()
      modulator.type = 'sine'
      modulator.frequency.setValueAtTime(freq * ratio, t0)

      const modGain = this.ctx.createGain()
      const deviation = freq * index * (0.5 + 0.85 * vel)
      modGain.gain.setValueAtTime(deviation, t0)
      modGain.gain.exponentialRampToValueAtTime(Math.max(0.05, deviation * 0.05), t0 + idxDecay)

      modulator.connect(modGain)
      modGain.connect(carrier.frequency)
      carrier.connect(bus)
      carrier.start(t0)
      modulator.start(t0)
      oscillators.push(carrier, modulator)
      gains.push(modGain)

      // 第二组轻微失谐的载波 → 宽厚的合唱感（避免单薄）
      const chorus = this.ctx.createOscillator()
      chorus.type = 'sine'
      chorus.frequency.setValueAtTime(freq, t0)
      chorus.detune.setValueAtTime((profile.stringDetune ?? 1) * 2.4, t0)
      const chGain = this.ctx.createGain()
      chGain.gain.setValueAtTime(0.42, t0)
      chorus.connect(chGain)
      chGain.connect(bus)
      chorus.start(t0)
      oscillators.push(chorus)
      gains.push(chGain)

      // Rhodes 的柔和颤音
      const tr = profile.tremoloRate ?? P.tremoloRate
      const td = profile.tremoloDepth ?? P.tremoloDepth
      if (tr > 0 && td > 0) {
        const lfo = this.ctx.createOscillator()
        lfo.type = 'sine'
        lfo.frequency.setValueAtTime(tr, t0)
        const lg = this.ctx.createGain()
        lg.gain.setValueAtTime(td, t0)
        lfo.connect(lg)
        lg.connect(bus.gain)
        lfo.start(t0)
        oscillators.push(lfo)
        gains.push(lg)
      }
    } else {
      // ── 加性泛音叠加 ──────────────────────────────────────────────────────
      // 弦间失谐（拍频）：中低音区拍频更慢更明显，高音区弦短、失谐感知弱
      const stringDetune = profile.stringDetune * (midi < 60 ? 1.35 : midi > 84 ? 0.7 : 1)
      const weights: Array<{ partial: number; w: number; i: number }> = []
      let sum = 0
      for (let i = 0; i < profile.partials.length; i++) {
        const partial = profile.partials[i]
        const baseGain = profile.partialGains[i]
        const velTilt = Math.pow(vel, profile.velBrightness * (partial - 1))
        const w = baseGain * Math.pow(pitchFactor, partial - 1) * profile.brightness * velTilt
        if (w < 0.004) continue
        const copies = i < 4 ? 2 : 1 // 前 4 个泛音做双弦拍频
        weights.push({ partial, w: w * copies, i })
        sum += w * copies
      }
      if (sum <= 0) sum = 1

      for (const { partial, w, i } of weights) {
        const amp = w / sum
        const inharm = profile.inharmonicity * partial * partial
        for (const s of i < 4 ? [-1, 1] : [0]) {
          const osc = this.ctx.createOscillator()
          osc.type = 'sine'
          osc.frequency.setValueAtTime(freq * partial * (1 + inharm), t0)
          osc.detune.setValueAtTime(s * stringDetune + (Math.random() - 0.5) * profile.detune * 0.6, t0)

          const g = this.ctx.createGain()
          // 高次泛音先收缩（真实弦行为），整体再由 master 的 ADSR 收尾
          g.gain.setValueAtTime(0, t0)
          g.gain.linearRampToValueAtTime(amp, t0 + attack * 1.2)
          g.gain.exponentialRampToValueAtTime(
            Math.max(0.0001, amp * 0.45),
            t0 + 0.16 + 0.05 * partial,
          )
          g.gain.exponentialRampToValueAtTime(0.0001, t0 + Math.min(profile.bodyDecay * 1.5, 8))

          osc.connect(g)
          g.connect(bus)
          osc.start(t0)
          oscillators.push(osc)
          gains.push(g)
        }
      }
    }

    bus.connect(tone)
    if (stereo) {
      tone.connect(stereo)
      stereo.connect(master)
    } else {
      tone.connect(master)
    }

    /**
     * 击弦瞬态：低频 thump（琴槌触弦）+ 高频 click（毛毡接触）。
     * 注意两处：
     *   ① 起音一律用 **5ms 以上的线性斜坡**，不再有 1.2ms 的硬跳 —— 那是爆音的来源；
     *   ② click 的电平按力度平方缩放并压得很低，只保留"木头感"，不再出现塑料哨声。
     */
    if (profile.hammerNoise > 0.001) {
      const src = this.ctx.createBufferSource()
      src.buffer = this.getNoiseBuffer()
      src.playbackRate.value = 0.7 + Math.random() * 0.6

      // thump：低通闷响，中心随音高
      const lp = this.ctx.createBiquadFilter()
      lp.type = 'lowpass'
      lp.frequency.value = Math.min(760, freq * 1.8 + 50)
      const tg = this.ctx.createGain()
      const tPeak = peakVel * profile.hammerNoise * 0.9
      tg.gain.setValueAtTime(0, t0)
      tg.gain.linearRampToValueAtTime(tPeak, t0 + 0.006)
      tg.gain.exponentialRampToValueAtTime(0.0001, t0 + profile.hammerDecay * 1.6)

      // click：带通高频接触瞬态
      const bp = this.ctx.createBiquadFilter()
      bp.type = 'bandpass'
      bp.frequency.value = Math.min(4200, freq * 3 + 1200)
      bp.Q.value = 0.7
      const cg = this.ctx.createGain()
      const cPeak = peakVel * profile.hammerNoise * Math.pow(vel, 2) * 0.35
      cg.gain.setValueAtTime(0, t0)
      cg.gain.linearRampToValueAtTime(cPeak, t0 + 0.005)
      cg.gain.exponentialRampToValueAtTime(0.0001, t0 + profile.hammerDecay)

      src.connect(lp)
      lp.connect(tg)
      src.connect(bp)
      bp.connect(cg)
      tg.connect(master)
      cg.connect(master)
      src.start(t0)
      src.stop(t0 + 0.5)
    }

    if (effects) {
      master.connect(this.dryBus)
      // 高频送更多混响，模拟空气感
      const send = this.ctx.createGain()
      send.gain.value = 0.5 + Math.max(0, Math.min(0.5, (midi - 60) / 60))
      master.connect(send)
      send.connect(this.wetBus)
    } else {
      master.connect(this.compressor)
    }

    const voice: LiveVoice = { midi, oscillators, gains, master, released: false, startTime: t0, preset }
    this.live.set(midi, voice)
    if (this._sustainPedal) this.sustainedVoices.add(midi)

    // 定长音自动释放
    if (duration !== undefined && !this._sustainPedal) {
      window.setTimeout(() => {
        if (this.live.get(midi) === voice && !voice.released) this.release(midi)
      }, Math.max(30, (duration + 0.3) * 1000))
    }
    return midi
  }

  noteOff(midi: number) {
    if (this._sustainPedal) return
    this.release(midi)
  }

  release(midi: number) {
    const voice = this.live.get(midi)
    if (!voice || voice.released) return
    // 用该声部自己的音色释放时间（旧实现一律用 grand 的 release）
    this.killVoice(voice, this.ctx.currentTime, PRESETS[voice.preset].release)
    this.live.delete(midi)
  }

  private killVoice(voice: LiveVoice, at: number, release: number) {
    if (voice.released) return
    voice.released = true
    const g = voice.master.gain
    try {
      g.cancelScheduledValues(at)
      g.setValueAtTime(Math.max(0.0001, g.value), at)
      g.exponentialRampToValueAtTime(0.0001, at + release)
    } catch {
      /* node 已结束 */
    }
    const stopAt = at + release + 0.06
    for (const osc of voice.oscillators) {
      try {
        osc.stop(stopAt)
      } catch {
        /* already stopped */
      }
    }
    window.setTimeout(() => {
      try {
        voice.master.disconnect()
      } catch {
        /* noop */
      }
    }, (release + 0.2) * 1000)
  }

  /** 释放所有发声（含踏板抬起） */
  allNotesOff() {
    this._sustainPedal = false
    this.sustainedVoices.clear()
    for (const [midi, voice] of Array.from(this.live.entries())) {
      this.killVoice(voice, this.ctx.currentTime, 0.16)
      this.live.delete(midi)
    }
  }

  /** 节拍器点击声（木鱼式：短促滤波噪声 + 正弦） */
  click(when: number, accent: boolean, opts: { muted?: boolean } = {}) {
    if (opts.muted) return
    const t = when
    const dest = this.metronomeGain
    const osc = this.ctx.createOscillator()
    osc.type = 'triangle'
    osc.frequency.setValueAtTime(accent ? 1560 : 1040, t)
    osc.frequency.exponentialRampToValueAtTime(accent ? 900 : 700, t + 0.045)
    const g = this.ctx.createGain()
    const peak = accent ? 0.5 : 0.26
    g.gain.setValueAtTime(0, t)
    g.gain.linearRampToValueAtTime(peak, t + 0.001)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.055)
    osc.connect(g)
    g.connect(dest)
    osc.start(t)
    osc.stop(t + 0.1)

    const noise = this.ctx.createBufferSource()
    noise.buffer = this.getNoiseBuffer()
    const hp = this.ctx.createBiquadFilter()
    hp.type = 'highpass'
    hp.frequency.value = accent ? 2400 : 1700
    const ng = this.ctx.createGain()
    ng.gain.setValueAtTime(accent ? 0.2 : 0.09, t)
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.028)
    noise.connect(hp)
    hp.connect(ng)
    ng.connect(dest)
    noise.start(t)
    noise.stop(t + 0.05)
  }

  /** 和弦快速琶音（教学示范用） */
  arpeggio(midis: number[], opts: { start?: number; step?: number; velocity?: number; preset?: PianoPreset } = {}) {
    const { start = 0, step = 0.075, velocity = 0.7, preset = 'grand' } = opts
    const t0 = this.ctx.currentTime + 0.06 + start
    midis.forEach((m, i) => {
      this.noteOn(m, { when: t0 + i * step, duration: step * 2.4 + 0.5, velocity, preset })
    })
    return t0 + midis.length * step
  }

  /** 单音示范（可重复，用于教学与"正确音高"对照） */
  demo(midi: number, velocity = 0.72, preset: PianoPreset = 'grand') {
    return this.noteOn(midi, { velocity, preset })
  }

  /** 节拍器前瞻调度器（Web Audio 精确时序） */
  createMetronome(getBpm: () => number) {
    let timer: number | null = null
    let nextNoteTime = 0
    let beat = 0
    let running = false
    const beatsPerMeasure = 3 // 默认 3/8
    let measureBeats = 3

    const schedule = () => {
      const bpm = getBpm()
      const spb = 60 / bpm
      const now = this.ctx.currentTime
      while (nextNoteTime < now + 0.14) {
        const accent = beat % measureBeats === 0
        this.click(nextNoteTime, accent)
        nextNoteTime += spb
        beat += 1
      }
    }

    // 提前捕获 engine 引用，供闭包内使用
    const engine = this
    return {
      start(fromBeat = 0) {
        if (running) return
        running = true
        beat = fromBeat
        nextNoteTime = engine.ctx.currentTime + 0.08
        schedule()
        timer = window.setInterval(schedule, 25)
      },
      stop() {
        running = false
        if (timer !== null) window.clearInterval(timer)
        timer = null
      },
      get running() {
        return running
      },
      setBeatsPerMeasure(n: number) {
        measureBeats = n
      },
    }
  }
}

let singleton: AudioEngine | null = null

export function getAudioEngine(): AudioEngine {
  if (!singleton) singleton = new AudioEngine()
  return singleton
}
