/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * useAutoPlayer.ts — 自动演奏的 React 绑定
 *
 * 职责边界：引擎（autoPlayEngine）负责时序与发声，本 hook 只做四件事：
 *   1. 构建诠释后的乐谱（memo，避免每次渲染重算 900+ 个音）
 *   2. 把引擎的状态快照接到 React state（引擎已内部节流到 ~20fps）
 *   3. **自动预热真实钢琴采样**（挂载即开始，带进度），让"点播放"就是真钢琴音色
 *   4. 卸载时清理，避免旧页面的回调继续驱动新页面
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAudioEngine, type PianoPreset } from '@/audio/audioEngine'
import { getAutoPlayEngine, type AutoPlaySnapshot } from '@/audio/autoPlayEngine'
import { buildAutoPlayScore, type AutoPlayScore, type InterpretationOptions } from '@/core/interpretation'
import type { Piece } from '@/core/score'

/** 采样音源状态机：idle → loading → ready / failed */
export type SampleLoadState = 'idle' | 'loading' | 'ready' | 'failed'

export interface UseAutoPlayerResult {
  score: AutoPlayScore
  snap: AutoPlaySnapshot
  /** 采样清单是否已启用 */
  sampleEnabled: boolean
  /** 采样加载阶段 */
  sampleState: SampleLoadState
  /** 采样名（如 Salamander Grand Piano V3） */
  sampleName: string
  /** 加载进度 0..1 */
  sampleProgress: number
  /** 本曲所需音高的采样覆盖率 0..1 */
  sampleCoverage: number
  sampleStats: { loaded: number; pending: number; failed: number; hits: number; misses: number }
  play: (fromBeat?: number) => void
  pause: () => void
  resume: () => void
  toggle: () => void
  stop: () => void
  seekBeat: (beat: number) => void
  seekProgress: (p: number) => void
  setBpm: (bpm: number) => void
  setVolume: (v: number) => void
  setReverb: (v: number) => void
  setTimbre: (p: PianoPreset) => void
  setPedalEnabled: (on: boolean) => void
  setResonance: (on: boolean) => void
  enableSamples: () => Promise<boolean>
  disableSamples: () => void
  /** 键盘试听：优先真实采样，未就绪则回退合成 */
  audition: (midi: number, velocity?: number) => void
  auditionOff: (midi: number) => void
}

export function useAutoPlayer(piece: Piece, interp?: InterpretationOptions): UseAutoPlayerResult {
  const engine = useMemo(() => getAutoPlayEngine(), [])

  const score = useMemo<AutoPlayScore>(() => buildAutoPlayScore(piece, interp), [piece, interp])

  const [snap, setSnap] = useState<AutoPlaySnapshot>(() => engine.peek())
  const [sampleEnabled, setSampleEnabled] = useState(false)
  const [sampleState, setSampleState] = useState<SampleLoadState>('idle')
  const [sampleName, setSampleName] = useState('')
  const [sampleProgress, setSampleProgress] = useState(0)
  const [sampleCoverage, setSampleCoverage] = useState(0)
  const [sampleStats, setSampleStats] = useState({ loaded: 0, pending: 0, failed: 0, hits: 0, misses: 0 })
  const mounted = useRef(true)

  // 乐谱（诠释结果）变化 → 交给引擎
  useEffect(() => {
    engine.setScore(score)
    engine.setCallbacks({
      onTick: setSnap,
      onSampleStats: () => {
        const s = engine.samples.stats()
        setSampleStats({ loaded: s.loaded, pending: s.pending, failed: s.failed, hits: s.hits, misses: s.misses })
      },
    })
    setSnap(engine.peek())
    return () => {
      engine.stop()
      engine.setCallbacks({})
    }
  }, [engine, score])

  /**
   * 自动预热真实钢琴采样。
   * 顺序很关键：先让 setScore 生效（上一个 effect），再按**本曲实际用到的音高**预取，
   * 否则会去下载整台琴 90 个采样，白白拖慢首播。
   */
  useEffect(() => {
    mounted.current = true
    let cancelled = false
    void (async () => {
      setSampleState('loading')
      const ok = await engine.samples.load('samples/manifest.json')
      if (cancelled || !mounted.current) return
      if (!ok) {
        setSampleState('failed')
        return
      }
      setSampleEnabled(true)
      setSampleName(engine.samples.manifestName)
      await engine.warmupSamples()
      if (cancelled || !mounted.current) return
      setSampleState('ready')
      setSampleProgress(1)
      setSampleCoverage(engine.sampleCoverage())
    })()
    return () => {
      cancelled = true
      mounted.current = false
    }
  }, [engine])

  // 加载期间轮询进度（播放前没有 onTick，必须自己轮询）
  useEffect(() => {
    if (sampleState !== 'loading') return
    const t = window.setInterval(() => {
      const s = engine.samples.stats()
      setSampleProgress(s.queued > 0 ? Math.min(0.99, s.done / s.queued) : 0)
      setSampleStats({ loaded: s.loaded, pending: s.pending, failed: s.failed, hits: s.hits, misses: s.misses })
      setSampleCoverage(engine.sampleCoverage())
    }, 150)
    return () => window.clearInterval(t)
  }, [sampleState, engine])

  const play = useCallback((fromBeat = 0) => engine.play(fromBeat), [engine])
  const pause = useCallback(() => engine.pause(), [engine])
  const resume = useCallback(() => engine.resume(), [engine])
  const toggle = useCallback(() => engine.toggle(), [engine])
  const stop = useCallback(() => engine.stop(), [engine])
  const seekBeat = useCallback((b: number) => engine.seekBeat(b), [engine])
  const seekProgress = useCallback((p: number) => engine.seekProgress(p), [engine])
  const setBpm = useCallback((b: number) => engine.setBpm(b), [engine])
  const setVolume = useCallback((v: number) => engine.setVolume(v), [engine])
  const setReverb = useCallback((v: number) => engine.applySettings({ reverb: v }), [engine])
  const setTimbre = useCallback((p: PianoPreset) => engine.applySettings({ preset: p }), [engine])
  const setPedalEnabled = useCallback((on: boolean) => engine.applySettings({ pedal: on }), [engine])
  const setResonance = useCallback((on: boolean) => engine.applySettings({ resonance: on }), [engine])

  const enableSamples = useCallback(async () => {
    setSampleState('loading')
    const ok = await engine.samples.load('samples/manifest.json')
    setSampleEnabled(engine.samples.available)
    if (ok) {
      setSampleName(engine.samples.manifestName)
      await engine.warmupSamples()
      setSampleState('ready')
      setSampleCoverage(engine.sampleCoverage())
    } else {
      setSampleState('failed')
    }
    return ok
  }, [engine])

  const disableSamples = useCallback(() => {
    engine.samples.disable()
    getAudioEngine().setVoiceSource('synth')
    setSampleEnabled(false)
    setSampleState('idle')
    setSampleProgress(0)
    setSampleCoverage(0)
  }, [engine])

  /** 键盘试听：先用真实采样；若该音尚未就绪则回退合成（保证"点了就有声"） */
  const audition = useCallback(
    (midi: number, velocity = 0.72) => {
      const ae = getAudioEngine()
      void ae.unlock()
      const when = ae.currentTime + 0.008
      const used = engine.samples.noteOn(midi, velocity, when, 3.2, false)
      if (!used) ae.noteOn(midi, { velocity, preset: 'warm', duration: 3.2 })
    },
    [engine],
  )

  const auditionOff = useCallback(
    (midi: number) => {
      engine.samples.noteOff(midi)
      getAudioEngine().noteOff(midi)
    },
    [engine],
  )

  return {
    score,
    snap,
    sampleEnabled,
    sampleState,
    sampleName,
    sampleProgress,
    sampleCoverage,
    sampleStats,
    play,
    pause,
    resume,
    toggle,
    stop,
    seekBeat,
    seekProgress,
    setBpm,
    setVolume,
    setReverb,
    setTimbre,
    setPedalEnabled,
    setResonance,
    enableSamples,
    disableSamples,
    audition,
    auditionOff,
  }
}
