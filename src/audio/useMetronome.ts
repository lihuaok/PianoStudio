/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * useMetronome.ts — 节拍器 Hook
 * 使用 Web Audio 前瞻调度（25ms 轮询 / 100ms 前瞻），保证节奏精度。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { getAudioEngine } from '@/audio/audioEngine'

export interface MetronomeOptions {
  bpm: number
  beatsPerMeasure: number
  accentFirst: boolean
  volume: number
  soundOn: boolean
  /** 每小节起始计数（跟弹时用） */
  countInMeasures?: number
}

export interface MetronomeState {
  isRunning: boolean
  /** 当前拍（0-based，在 beatsPerMeasure 内循环） */
  currentBeat: number
  /** 当前小节（1-based） */
  currentBar: number
  /** 每拍是否重音 */
  isAccent: boolean
  /** 视觉脉冲（用于节拍器摆动动画） */
  pulse: number
}

export function useMetronome(options: MetronomeOptions) {
  const [state, setState] = useState<MetronomeState>({
    isRunning: false,
    currentBeat: 0,
    currentBar: 1,
    isAccent: false,
    pulse: 0,
  })

  const bpmRef = useRef(options.bpm)
  const bpmDisplay = useRef(options.bpm)
  const beatsRef = useRef(options.beatsPerMeasure)
  const accentRef = useRef(options.accentFirst)
  const soundRef = useRef(options.soundOn)

  bpmDisplay.current = options.bpm
  beatsRef.current = options.beatsPerMeasure
  accentRef.current = options.accentFirst
  soundRef.current = options.soundOn

  const timerRef = useRef<number | null>(null)
  const beatRef = useRef(0)
  const runningRef = useRef(false)

  // ── 调度循环 ────────────────────────────────────────────────────────────
  const schedule = useCallback(() => {
    const engine = getAudioEngine()
    const now = engine.currentTime
    const bpm = bpmDisplay.current
    const spb = 60 / bpm
    // 前瞻 120ms
    while (nextTimeRef.current < now + 0.12) {
      const beat = beatRef.current
      const isAccent = accentRef.current && beat === 0
      if (soundRef.current) {
        engine.click(nextTimeRef.current, isAccent)
      }
      // 计算这一拍在 UI 上的触发时刻
      const delay = Math.max(0, (nextTimeRef.current - now) * 1000)
      const targetBeat = beat
      window.setTimeout(() => {
        if (!runningRef.current) return
        setState((s) => ({
          ...s,
          currentBeat: targetBeat,
          currentBar: Math.floor(targetBeat / beatsRef.current) + 1,
          isAccent: isAccent,
          pulse: s.pulse + 1,
        }))
      }, delay)

      nextTimeRef.current += spb
      beatRef.current = beatRef.current + 1
    }
  }, [])

  const nextTimeRef = useRef(0)

  const start = useCallback(() => {
    if (runningRef.current) return
    const engine = getAudioEngine()
    void engine.unlock()
    runningRef.current = true
    beatRef.current = 0
    nextTimeRef.current = engine.currentTime + 0.08
    setState((s) => ({ ...s, isRunning: true }))
    schedule()
    timerRef.current = window.setInterval(schedule, 25)
  }, [schedule])

  const stop = useCallback(() => {
    runningRef.current = false
    if (timerRef.current !== null) window.clearInterval(timerRef.current)
    timerRef.current = null
    setState((s) => ({ ...s, isRunning: false }))
  }, [])

  const toggle = useCallback(() => {
    if (runningRef.current) stop()
    else start()
  }, [start, stop])

  // 速度变化时重置调度基准（避免节奏跳变）
  useEffect(() => {
    bpmRef.current = options.bpm
    if (runningRef.current) {
      const engine = getAudioEngine()
      // 保持连续性：不重置 beat，只更新速度
      nextTimeRef.current = Math.max(nextTimeRef.current, engine.currentTime + 0.02)
    }
  }, [options.bpm])

  useEffect(() => {
    return () => {
      runningRef.current = false
      if (timerRef.current !== null) window.clearInterval(timerRef.current)
    }
  }, [])

  // 每拍时长（用于视觉动画）
  const beatDuration = 60 / options.bpm

  return { ...state, start, stop, toggle, beatDuration }
}
