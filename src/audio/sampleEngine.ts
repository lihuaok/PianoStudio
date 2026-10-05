/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * sampleEngine.ts — 真实钢琴采样音源（Salamander Grand Piano V3）
 *
 * 为什么要有这一层：纯合成再怎么调，泛音的"呼吸"与琴体的自然共鸣都补不出来，
 * 听感始终是"电子琴"。真钢琴要的不是更复杂的波形，而是**真实的录音**。
 *
 * 本引擎的关键设计（每一条都对应一个具体的听感问题）：
 *
 *  1. **稀疏采样 + 变速（sparse layout）**
 *     Salamander 每 3 个半音录一个采样点（A0, C1, D#1, F#1, A1 … 共 30 个）。
 *     播放时取最近的采样点并按 2^(Δ半音/12) 变速。±1.5 半音内的变速听不出音色损失，
 *     却把音源体积从"每音一文件"压缩到 1/3。
 *
 *  2. **mp3 编码延迟补偿（leadOffset）**
 *     mp3 解码后开头有约 20~50ms 的编码填充静音。若直接从 0 播放，
 *     整首曲子会"迟半个字"、起音发闷——这是采样方案最容易被忽略的致命细节。
 *     这里在解码后扫描真实起音点，播放时用 start(when, offset) 跳过去。
 *
 *  3. **多力度层 + 跨层连续映射**
 *     弱/中/强三层录音的原始响度差好几个 dB。若直接切换层，中段会有"台阶"。
 *     做法：层增益（manifest.gain）先把录音响度差抵消掉，再用**全局同一条**力度曲线
 *     F(velocity) 控制音量 —— 于是层与层之间天然连续，听不出接缝。
 *
 *  4. **软回退**
 *     某个音需要的采样还没加载好时，先借同音高其它层（增益补偿），再不行返回 false
 *     交给合成音源。任何情况下都不会出现"漏音"。
 *
 *  5. **踏板语义与钢琴一致**
 *     踏板踩下时不人为截断，让录音自然衰减（这就是延音踏板本来的声音）；
 *     踏板抬起时统一释放（制音器落下）。声部数有上限，超出时淘汰最旧的。
 *
 * 启用方式：public/samples/ 放采样 + manifest.json 即可，代码零改动。
 */

export interface SampleLayer {
  /** 该层覆盖的力度上界（0..1） */
  max: number
  /** 文件名后缀，如 'v3' → C4v3.mp3 */
  suffix: string
  /** 层增益：用来抵消该层录音的原始响度差（由标定得出） */
  gain?: number
  label?: string
}

export interface SampleManifest {
  name: string
  license?: string
  /** 采样文件的基础 URL（相对站点根，如 'samples/'） */
  baseUrl: string
  /** 扩展名（mp3 / ogg / wav） */
  ext: string
  /** 'sparse' = 稀疏采样点 + 变速（推荐）；'perNote' = 每个音高一个文件 */
  layout?: 'perNote' | 'sparse'
  /** 命名规则：'scientific' = C4 / D#4；'midi' = 60 */
  noteName?: 'scientific' | 'midi'
  /** sparse 布局：默认锚点（MIDI） */
  anchorStart?: number
  anchorStep?: number
  /** 松键衰减（秒） */
  release?: number
  /** 踏板踩下时单个音最多延长多少秒（防止声部无限堆积） */
  pedalTail?: number
  /** 力度分层（由弱到强） */
  layers: SampleLayer[]
}

export interface SampleStats {
  enabled: boolean
  loaded: number
  pending: number
  failed: number
  bytes: number
  budget: number
  hits: number
  misses: number
  /** 本轮预取总任务 / 已完成（进度条用） */
  queued: number
  done: number
}

const NOTE_LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

export function midiToScientific(midi: number): string {
  const pc = ((midi % 12) + 12) % 12
  const oct = Math.floor(midi / 12) - 1
  return `${NOTE_LETTERS[pc]}${oct}`
}

/** 解码后的一个采样 */
interface Decoded {
  buffer: AudioBuffer
  /** 真实起音位置（秒）：跳过 mp3 编码填充 */
  lead: number
  /** 可用结束位置（秒） */
  end: number
  midi: number
  layer: number
  rms: number
}

interface SampleVoice {
  midi: number
  src: AudioBufferSourceNode
  gain: GainNode
  /** 音频时钟上的起音时刻 */
  startedAt: number
  /** 由踏板维持中（踏板抬起才释放） */
  sustained: boolean
  released: boolean
  /** 本次触发的计划释放时间（音频时钟） */
  offAt: number
}

const MAX_VOICES = 96
const CONCURRENCY = 8
/** 起音检测阈值：低于此值视为 mp3 编码填充的静音 */
const LEAD_EPS = 0.0025
/** 回退检测时往前保留的余量（秒），避免削掉极弱起音 */
const LEAD_BACKOFF = 0.004

export class SampleEngine {
  private ctx: AudioContext
  private dry: GainNode
  private wet: GainNode
  private manifest: SampleManifest | null = null
  private samples = new Map<string, Decoded>()
  /** LRU：最近使用排在末尾 */
  private order: string[] = []
  private pending = new Set<string>()
  private failed = new Set<string>()
  private bytes = 0
  private hits = 0
  private misses = 0
  private budget: number
  private concurrency = 0
  private queue: string[] = []
  private voices: SampleVoice[] = []
  private live = new Map<number, SampleVoice[]>()
  private _pedal = false
  private paused = false
  /** 本轮预取任务数（进度用） */
  private queuedTotal = 0
  private doneCount = 0

  constructor(ctx: AudioContext, dry: GainNode, wet: GainNode, budgetMB = 256) {
    this.ctx = ctx
    this.dry = dry
    this.wet = wet
    this.budget = budgetMB * 1024 * 1024
  }

  get available(): boolean {
    return this.manifest !== null
  }

  get manifestName(): string {
    return this.manifest?.name ?? '未启用（合成音源）'
  }

  get sustainPedalDown(): boolean {
    return this._pedal
  }

  /** 读取并启用采样清单；失败返回 false（保持合成音源） */
  async load(manifestUrl = 'samples/manifest.json'): Promise<boolean> {
    if (this.manifest) return true
    try {
      const res = await fetch(manifestUrl, { cache: 'force-cache' })
      if (!res.ok) return false
      const manifest = (await res.json()) as SampleManifest
      if (!manifest?.baseUrl || !manifest.layers?.length) return false
      this.manifest = manifest
      return true
    } catch {
      return false
    }
  }

  /** 禁用采样（回退合成），并停掉所有采样声部 */
  disable() {
    this.manifest = null
    this.allNotesOff()
  }

  /* ────────── 命名与寻址 ────────── */

  private anchors(): { start: number; step: number } {
    const m = this.manifest!
    return { start: m.anchorStart ?? 21, step: m.anchorStep ?? 3 }
  }

  /** 离该音高最近的采样锚点 */
  private nearestAnchor(midi: number): number {
    if ((this.manifest?.layout ?? 'perNote') === 'perNote') return midi
    const { start, step } = this.anchors()
    return start + Math.round((midi - start) / step) * step
  }

  private keyOf(anchor: number, layer: number): string {
    const m = this.manifest!
    const note = (m.noteName ?? 'scientific') === 'midi' ? String(anchor) : midiToScientific(anchor)
    return `${note}${m.layers[layer].suffix}`
  }

  private urlOf(key: string): string {
    const m = this.manifest!
    /**
     * 必须做 URL 编码：`#` 在 URL 里是 fragment 分隔符，
     * `D#3v9.mp3` 不编码会被浏览器截断成 `D`，直接 404。
     * 这一条曾经让全曲所有升号音（含开头动机的 D♯）静默消失——
     * 表现为"能听到声音但旋律完全不对"，极难从听感上反推。
     */
    return `${m.baseUrl}${encodeURIComponent(key)}.${m.ext}`
  }

  /** 力度 → 层索引 */
  private layerAt(velocity: number): number {
    const layers = this.manifest!.layers
    for (let i = 0; i < layers.length; i++) if (velocity <= layers[i].max) return i
    return layers.length - 1
  }

  private get decodedCount(): number {
    return this.samples.size
  }

  /**
   * 该音高当前是否"已就绪"（任一层的最近锚点已加载）。
   * 播放前的等待判定用它，避免开头几个音落到合成音源上造成音色跳变。
   */
  has(midi: number, _velocity = 0.6): boolean {
    if (!this.manifest) return false
    const anchor = this.nearestAnchor(midi)
    for (let i = 0; i < this.manifest.layers.length; i++) {
      if (this.samples.has(this.keyOf(anchor, i))) return true
    }
    return false
  }

  /** 指定音高在指定力度下是否完全就绪（严格版，用于进度判定） */
  hasExact(midi: number, velocity: number): boolean {
    if (!this.manifest) return false
    return this.samples.has(this.keyOf(this.nearestAnchor(midi), this.layerAt(velocity)))
  }

  /** 拾取该音高可用的采样（优先目标层，其次相邻层；返回 {sample, layer}） */
  private pick(midi: number, velocity: number): { s: Decoded; layer: number } | null {
    const m = this.manifest!
    const anchor = this.nearestAnchor(midi)
    const want = this.layerAt(velocity)
    const order = [want]
    // 先近后远地试探其它层（借用时用增益补偿，听感依然连续）
    for (let d = 1; d < m.layers.length; d++) {
      if (want - d >= 0) order.push(want - d)
      if (want + d < m.layers.length) order.push(want + d)
    }
    for (const li of order) {
      const key = this.keyOf(anchor, li)
      const s = this.samples.get(key)
      if (s) {
        this.touch(key)
        return { s, layer: li }
      }
      void this.enqueue(key)
    }
    return null
  }

  /* ────────── 预取 ────────── */

  /**
   * 预取一批音高。
   * @param layer 'all' = 全部力度层（首播前用）；'current' = 只取中间层（快速起播）
   */
  prefetch(midis: number[], layer: 'all' | 'current' = 'all') {
    if (!this.manifest) return
    const m = this.manifest
    const anchors = new Set<number>()
    for (const midi of midis) anchors.add(this.nearestAnchor(midi))
    const mids = layer === 'all' ? [...Array(m.layers.length).keys()] : [Math.floor(m.layers.length / 2)]
    for (const a of anchors) for (const li of mids) void this.enqueue(this.keyOf(a, li))
  }

  /**
   * 等待指定音高的采样就绪（带超时）。
   * 返回 true 表示已就绪；false 表示超时或不可用（调用方决定是否仍开始播放）。
   */
  async prepare(midis: number[], timeoutMs = 12000, layer: 'all' | 'current' = 'all'): Promise<boolean> {
    if (!this.manifest) return false
    this.prefetch(midis, layer)
    if (layer === 'current') {
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline) {
        if (this.pending.size === 0 && this.queue.length === 0) return true
        await delay(40)
      }
      return false
    }
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline) {
      if (this.pending.size === 0 && this.queue.length === 0) return true
      await delay(40)
    }
    return false
  }

  private async enqueue(key: string): Promise<void> {
    if (!this.manifest || this.samples.has(key) || this.failed.has(key) || this.pending.has(key)) return
    this.pending.add(key)
    this.queuedTotal++
    this.queue.push(key)
    this.pump()
  }

  private pump() {
    while (this.concurrency < CONCURRENCY) {
      const key = this.queue.shift()
      if (!key) return
      this.concurrency++
      void this.fetchOne(key).finally(() => {
        this.concurrency--
        this.doneCount++
        this.pump()
      })
    }
  }

  private async fetchOne(key: string) {
    try {
      const res = await fetch(this.urlOf(key), { cache: 'force-cache' })
      if (!res.ok) throw new Error('HTTP ' + res.status)
      const data = await res.arrayBuffer()
      const raw = await this.ctx.decodeAudioData(data)
      const midi = this.parseMidiOf(key)
      const layer = this.parseLayerOf(key)
      const a = analyse(raw)
      /**
       * 解码后立刻裁剪。
       * Salamander 的原始采样是"一直录到完全静音"，低音区长达 22 秒；
       * 90 个这样的 buffer 解码后接近 500MB，LRU 会疯狂互踢（听感是音色忽好忽坏）。
       * 裁剪规则：从真实起音点切到"自然衰减结束"，超出按音高上限截断并做 350ms 淡出。
       * 顺带把 mp3 编码填充静音也一并切掉，于是播放时 offset 恒为 0。
       */
      const buffer = trimBuffer(this.ctx, raw, a.lead, a.end, keepSeconds(midi))
      const size = buffer.length * buffer.numberOfChannels * 4
      this.samples.set(key, { buffer, lead: 0, end: buffer.duration, midi, layer, rms: a.rms })
      this.bytes += size
      this.touch(key)
      this.evictIfNeeded()
    } catch {
      this.failed.add(key)
    } finally {
      this.pending.delete(key)
    }
  }

  private parseMidiOf(key: string): number {
    const m = this.manifest!
    const suffix = m.layers[this.parseLayerOf(key)].suffix
    const note = key.slice(0, key.length - suffix.length)
    if ((m.noteName ?? 'scientific') === 'midi') return Number(note)
    const mm = /^([A-G])(#?)(-?\d+)$/.exec(note)
    if (!mm) return 60
    const base = NOTE_LETTERS.indexOf(mm[1] + mm[2])
    return (Number(mm[3]) + 1) * 12 + base
  }

  private parseLayerOf(key: string): number {
    const layers = this.manifest!.layers
    for (let i = 0; i < layers.length; i++) if (key.endsWith(layers[i].suffix)) return i
    return Math.floor(layers.length / 2)
  }

  /* ────────── 发声 ────────── */

  /**
   * 尝试用采样发声。
   * @returns true = 已用采样发声；false = 该音尚无可用采样，调用方应回退合成音源
   */
  noteOn(midi: number, velocity: number, when: number, duration: number, pedal = false): boolean {
    if (!this.manifest || this.paused) return false
    const hit = this.pick(midi, velocity)
    if (!hit) {
      this.misses++
      return false
    }
    this.hits++
    this.playDecoded(hit.s, hit.layer, midi, velocity, when, duration, pedal)
    return true
  }

  private playDecoded(
    s: Decoded,
    layer: number,
    midi: number,
    velocity: number,
    when: number,
    duration: number,
    pedal: boolean,
  ) {
    const m = this.manifest!
    const t = Math.max(when, this.ctx.currentTime)
    const rate = Math.pow(2, (midi - s.midi) / 12)

    const src = this.ctx.createBufferSource()
    src.buffer = s.buffer
    src.playbackRate.value = rate

    // 层增益抵消录音响度差；F 是所有层共用的全局曲线 → 跨层无缝（见文件头第 3 条）。
    // 前导系数按**实测输出**标定：全曲峰值落在 0.85~0.95、RMS 约 −22dBFS
    // （独奏钢琴的合理范围），并给用户把音量推到 100% 留出约 2dB 余量。
    const layerGain = m.layers[layer]?.gain ?? 1
    const F = Math.pow(Math.max(0.08, Math.min(1.05, velocity)) / 0.5, 1.6)
    const peak = 1.25 * layerGain * F

    const g = this.ctx.createGain()
    g.gain.setValueAtTime(0, t)
    // 2ms 起音斜坡：采样自带真实起音瞬态，这里只防止 gain 突变产生的 click
    g.gain.linearRampToValueAtTime(peak, t + 0.002)
    // 下坡（decay）交给录音本身，不做人工塑形

    void F

    // 释放：踏板踩下时交给踏板状态机，否则到时落制音器
    const rel = m.release ?? 0.24
    let offAt = Infinity
    if (!pedal) {
      offAt = t + Math.max(0.05, duration)
      g.gain.setValueAtTime(peak, Math.max(t, offAt - rel * 0.35))
      g.gain.exponentialRampToValueAtTime(0.0001, offAt + rel * 0.65)
    }

    // 采样自身的可用时长（可变速率换算成墙钟时间）
    const bufferLeft = Math.max(0.05, (s.end - s.lead) / rate)
    const naturalEnd = t + bufferLeft
    const stopAt = Math.min(naturalEnd, pedal ? t + (m.pedalTail ?? 5.5) : offAt + rel * 0.75 + 0.05)

    const pan = this.ctx.createStereoPanner?.()
    if (pan) pan.pan.value = Math.max(-0.55, Math.min(0.55, ((midi - 64) / 44) * 0.45))

    src.connect(g)
    if (pan) {
      g.connect(pan)
      pan.connect(this.dry)
      const send = this.ctx.createGain()
      // 高音送更多混响（空气感），与合成音源保持一致的处理
      send.gain.value = 0.3 + Math.max(0, Math.min(0.35, (midi - 55) / 100))
      pan.connect(send)
      send.connect(this.wet)
    } else {
      g.connect(this.dry)
      const send = this.ctx.createGain()
      send.gain.value = 0.3 + Math.max(0, Math.min(0.35, (midi - 55) / 100))
      g.connect(send)
      send.connect(this.wet)
    }

    src.start(t, s.lead)
    src.stop(Math.max(stopAt, t + 0.02))

    const voice: SampleVoice = {
      midi,
      src,
      gain: g,
      startedAt: t,
      sustained: pedal,
      released: false,
      offAt,
    }
    this.voices.push(voice)
    const arr = this.live.get(midi)
    if (arr) arr.push(voice)
    else this.live.set(midi, [voice])

    src.onended = () => {
      this.dropVoice(voice)
      try {
        src.disconnect()
        g.disconnect()
        pan?.disconnect()
      } catch {
        /* noop */
      }
    }
    this.enforceLimit()
  }

  private dropVoice(v: SampleVoice) {
    const i = this.voices.indexOf(v)
    if (i >= 0) this.voices.splice(i, 1)
    const arr = this.live.get(v.midi)
    if (arr) {
      const j = arr.indexOf(v)
      if (j >= 0) arr.splice(j, 1)
      if (!arr.length) this.live.delete(v.midi)
    }
  }

  /** 声部数上限：超出时先淘汰最旧的非踏板声部，避免长踏板段落糊成一片 */
  private enforceLimit() {
    if (this.voices.length <= MAX_VOICES) return
    const victims = this.voices
      .filter((v) => !v.released && !v.sustained)
      .sort((a, b) => a.startedAt - b.startedAt)
    let need = this.voices.length - MAX_VOICES
    for (const v of victims) {
      if (need-- <= 0) break
      this.releaseVoice(v, 0.09)
    }
  }

  private releaseVoice(v: SampleVoice, rel: number) {
    if (v.released) return
    v.released = true
    const now = this.ctx.currentTime
    const g = v.gain.gain
    try {
      g.cancelScheduledValues(now)
      g.setValueAtTime(Math.max(0.0001, g.value), now)
      g.exponentialRampToValueAtTime(0.0001, now + rel)
    } catch {
      /* node 已结束 */
    }
    try {
      v.src.stop(now + rel + 0.03)
    } catch {
      /* already stopped */
    }
  }

  /** 某音高当前是否仍在发声 */
  isSounding(midi: number): boolean {
    const arr = this.live.get(midi)
    return !!arr && arr.some((v) => !v.released)
  }

  /** 松键：落制音器（踏板踩下时按钢琴语义忽略）。供键盘试听使用 */
  noteOff(midi: number) {
    if (this._pedal) return
    const arr = this.live.get(midi)
    if (!arr) return
    for (const v of arr) if (!v.released) this.releaseVoice(v, 0.24)
  }

  /**
   * 踏板状态。踩下：让采样自然衰减（不做任何截断），这就是延音踏板的声音。
   * 抬起：所有仍在响的采样统一落制音器（0.3s 衰减）。
   */
  setSustainPedal(down: boolean) {
    if (this._pedal === down) return
    this._pedal = down
    if (!down) {
      for (const v of [...this.voices]) {
        if (!v.released) this.releaseVoice(v, 0.3)
      }
    }
  }

  /** 立即停止所有采样声部 */
  allNotesOff() {
    this._pedal = false
    for (const v of [...this.voices]) this.releaseVoice(v, 0.12)
  }

  /** 暂停语义：不再触发新音，但已发声的让它自然走完（避免"断电"感） */
  setPaused(p: boolean) {
    this.paused = p
  }

  /* ────────── 缓存维护 ────────── */

  private evictIfNeeded() {
    while (this.bytes > this.budget && this.order.length > 1) {
      const victim = this.order.shift()
      if (!victim) break
      const s = this.samples.get(victim)
      if (s) {
        this.bytes -= s.buffer.length * s.buffer.numberOfChannels * 4
        this.samples.delete(victim)
      }
    }
  }

  private touch(key: string) {
    const i = this.order.indexOf(key)
    if (i >= 0) this.order.splice(i, 1)
    this.order.push(key)
  }

  stats(): SampleStats {
    return {
      enabled: this.manifest !== null,
      loaded: this.decodedCount,
      pending: this.pending.size,
      failed: this.failed.size,
      bytes: this.bytes,
      budget: this.budget,
      hits: this.hits,
      misses: this.misses,
      queued: this.queuedTotal,
      done: this.doneCount,
    }
  }

  /** 调试/自检用：返回已加载的采样键 */
  loadedKeys(): string[] {
    return [...this.samples.keys()].sort()
  }
}

function delay(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/**
 * 每个音高最多保留多少秒的采样。
 * 依据是**要被后一个音盖住之前需要多长**：低音区余韵长且常做踏板低音，留 12 秒；
 * 高音区衰减本来就快，留 4 秒足够。这样既保住自然衰减，又不让内存失控。
 */
function keepSeconds(midi: number): number {
  if (midi < 45) return 12
  if (midi < 57) return 9
  if (midi < 69) return 7
  if (midi < 81) return 5.5
  return 4
}

/**
 * 按 [lead, end] 裁出一个更短的 buffer，顺带跳过 mp3 编码填充静音。
 * 若可保留长度不足自然长度，则在尾部做 350ms 线性淡出，避免截断产生爆音。
 */
function trimBuffer(ctx: AudioContext, buf: AudioBuffer, lead: number, end: number, maxKeep: number): AudioBuffer {
  const rate = buf.sampleRate
  const start = Math.max(0, Math.floor(lead * rate))
  const natural = Math.max(1024, Math.floor((end - lead) * rate))
  const limit = Math.floor(maxKeep * rate)
  const truncated = natural > limit
  const keep = Math.min(natural, limit)
  const fade = truncated ? Math.floor(rate * 0.35) : 0
  const length = Math.max(1024, keep + fade)
  const chs = Math.max(1, Math.min(2, buf.numberOfChannels))
  const out = ctx.createBuffer(chs, length, rate)
  for (let c = 0; c < chs; c++) {
    const src = buf.getChannelData(c)
    const dst = out.getChannelData(c)
    const n = Math.min(length, Math.max(0, src.length - start))
    for (let i = 0; i < n; i++) dst[i] = src[start + i]
    for (let i = keep; i < length; i++) dst[i] *= 1 - (i - keep) / Math.max(1, fade)
  }
  return out
}

/**
 * 分析一段解码后的采样：
 *  · lead：真实起音点（跳过 mp3 编码填充静音）
 *  · end ：可用结束点（裁掉尾部静音）
 *  · rms ：有效段的均方根（供层响度标定参考）
 */
function analyse(buffer: AudioBuffer): { lead: number; end: number; rms: number } {
  const rate = buffer.sampleRate
  const n = buffer.length
  const chs: Float32Array[] = []
  for (let c = 0; c < Math.min(2, buffer.numberOfChannels); c++) chs.push(buffer.getChannelData(c))
  const at = (i: number) => {
    let v = 0
    for (const d of chs) v += Math.abs(d[i])
    return v / chs.length
  }

  let lead = 0
  const leadMax = Math.min(n, Math.floor(rate * 0.35))
  for (let i = 0; i < leadMax; i++) {
    if (at(i) > LEAD_EPS) {
      lead = Math.max(0, (i - Math.floor(rate * LEAD_BACKOFF)) / rate)
      break
    }
  }

  let endIdx = n - 1
  const minEnd = Math.floor(rate * 0.1)
  for (let i = n - 1; i > minEnd; i--) {
    if (at(i) > 0.0012) {
      endIdx = Math.min(n - 1, i + Math.floor(rate * 0.01))
      break
    }
  }

  // RMS：取起音后 1.2 秒（避开尾部环境噪声，也不被单个峰值主导）
  const s0 = Math.floor(lead * rate)
  const s1 = Math.min(endIdx, s0 + Math.floor(rate * 1.2))
  let sum = 0
  let cnt = 0
  for (let i = s0; i < s1; i++) {
    const v = at(i)
    sum += v * v
    cnt++
  }
  const rms = cnt > 0 ? Math.sqrt(sum / cnt) : 0

  return { lead, end: endIdx / rate, rms }
}
