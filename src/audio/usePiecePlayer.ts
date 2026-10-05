/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * usePiecePlayer.ts — 曲目播放器 Hook
 *
 * 调度策略（修复「完整乐曲播放中断」）：
 *  旧实现把全曲所有音符一次性预调度：同步创建上万个 Web Audio 节点 + 约 1600 个
 *  setTimeout，主线程冻结、音频图过载，导致播放卡死中断。
 *  新实现采用「前瞻调度器」（A Tale of Two Clocks 模式，与节拍器同范式）：
 *   - 25ms 轮询，每次只把未来 ~0.35s 内的音符写入音频时钟（Web Audio 绝对时间，精度高）
 *   - 视觉高亮由 rAF 指针推进，不再为每个音符挂 setTimeout
 *   - 循环段落由调度器在段落末尾自动重绕
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { getAudioEngine, type PianoPreset } from '@/audio/audioEngine'
import type { FlatEvent, Piece } from '@/core/score'
import { toFlatEvents } from '@/core/score'

export type PlayMode = 'listen' | 'wait' | 'record'

export interface PlayerState {
  isPlaying: boolean
  /** 当前时间（秒，从播放起点算） */
  currentTime: number
  /** 当前绝对小节 */
  currentMeasure: number
  /** 当前应弹的音符索引 */
  currentIndex: number
  /** 已播放到的音符索引 */
  playedUpTo: number
  /** 循环区间（小节） */
  loop: [number, number] | null
  duration: number
}

export interface UsePiecePlayerOptions {
  piece: Piece
  bpm: number
  measureRange?: [number, number]
  hand: 'right' | 'left' | 'both'
  volume: number
  preset: PianoPreset
  countIn: boolean
  onEvent?: (event: FlatEvent, index: number) => void
  onComplete?: () => void
}

/** 前瞻窗口：每次 tick 往音频时钟里写未来多久的音符 */
const LOOKAHEAD_S = 0.35
/** 调度轮询间隔 */
const TICK_MS = 25
/** 段落结束后再等多久才算播放完成（让尾音自然衰减） */
const TAIL_S = 0.5

export function usePiecePlayer(options: UsePiecePlayerOptions) {
  const { piece, bpm, measureRange, hand, volume, preset, countIn } = options

  const [state, setState] = useState<PlayerState>({
    isPlaying: false,
    currentTime: 0,
    currentMeasure: 0,
    currentIndex: 0,
    playedUpTo: -1,
    loop: null,
    duration: 0,
  })

  const eventsRef = useRef<FlatEvent[]>([])
  const timerRef = useRef<number | null>(null)
  const rafRef = useRef<number | null>(null)
  const stoppedRef = useRef(true)

  // ── 调度游标 ────────────────────────────────────────────────────────────
  const cursorRef = useRef(0)        // 下一个待调度音符的索引
  const visIdxRef = useRef(0)        // 视觉指针（已跨过的事件）
  const segStartRef = useRef(0)      // 当前段落起始索引（循环时为循环段起点）
  const segEndRef = useRef(0)        // 当前段落结束索引（含）
  const segBaseBeatRef = useRef(0)   // 段落起始音的 onsetBeat
  const segAudioStartRef = useRef(0) // 段落起始的 AudioContext 绝对时间
  const segWallStartRef = useRef(0)  // 段落起始对应的墙钟时间（performance.now）
  const loopRef = useRef<[number, number] | null>(null)
  const lastVisTimeRef = useRef(0)

  const onEventRef = useRef(options.onEvent)
  const onCompleteRef = useRef(options.onComplete)
  onEventRef.current = options.onEvent
  onCompleteRef.current = options.onComplete

  // ── 构建音符事件列表 ────────────────────────────────────────────────────
  const events = useMemo<FlatEvent[]>(() => {
    const all = toFlatEvents(piece)
    return all
      .filter((e) => {
        if (hand !== 'both' && e.hand !== hand) return false
        if (measureRange && (e.measure < measureRange[0] || e.measure > measureRange[1])) return false
        return true
      })
      .sort((a, b) => a.onsetBeat - b.onsetBeat)
  }, [piece, hand, measureRange])

  useEffect(() => {
    eventsRef.current = events
  }, [events])

  const beatsPerMeasure = piece.timeSignature[0]
  const secondsPerBeat = 60 / bpm
  const duration = events.length ? events[events.length - 1].onsetBeat + events[events.length - 1].durationBeats : 0

  useEffect(() => {
    setState((s) => ({ ...s, duration: duration * secondsPerBeat }))
  }, [duration, secondsPerBeat])

  // ── 清除调度器 ──────────────────────────────────────────────────────────
  const clearScheduler = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [])

  const stop = useCallback(() => {
    stoppedRef.current = true
    clearScheduler()
    getAudioEngine().allNotesOff()
    setState((s) => ({ ...s, isPlaying: false, currentTime: 0, currentMeasure: 0, currentIndex: 0, playedUpTo: -1 }))
  }, [clearScheduler])

  // ── 播放 ────────────────────────────────────────────────────────────────
  const play = useCallback(
    (fromIndex = 0) => {
      const engine = getAudioEngine()
      void engine.unlock()
      engine.setMasterVolume(volume)
      clearScheduler()
      stoppedRef.current = false

      const evts = eventsRef.current
      if (evts.length === 0) return

      const spb = secondsPerBeat
      const loopRange = loopRef.current

      // 确定播放段落：循环模式下是循环小节区间，否则是全部事件
      let segStart = 0
      let segEnd = evts.length - 1
      if (loopRange) {
        const s = evts.findIndex((e) => e.measure >= loopRange[0])
        let eIdx = evts.length - 1
        for (let i = Math.max(0, s); i < evts.length; i++) {
          if (evts[i].measure > loopRange[1]) {
            eIdx = i - 1
            break
          }
        }
        if (s >= 0 && eIdx >= s) {
          segStart = s
          segEnd = eIdx
        }
      }
      let idx = Math.max(segStart, Math.min(segEnd, fromIndex))

      const countInBeats = countIn ? beatsPerMeasure : 0
      const lead = 0.12
      const audioStart = engine.currentTime + lead + countInBeats * spb

      segStartRef.current = segStart
      segEndRef.current = segEnd
      segBaseBeatRef.current = evts[segStart].onsetBeat
      segAudioStartRef.current = audioStart
      segWallStartRef.current = performance.now() / 1000 + (audioStart - engine.currentTime)
      cursorRef.current = idx
      visIdxRef.current = idx
      lastVisTimeRef.current = 0

      // 数拍提示音（count-in）：在正式演奏前把每拍 click 排进音频时钟
      if (countInBeats > 0) {
        for (let b = 0; b < countInBeats; b++) {
          engine.click(audioStart - (countInBeats - b) * spb, b === 0)
        }
      }

      /** 当前段落末拍的绝对时刻（AudioContext 时间） */
      const segEndWhen = () => {
        const last = evts[segEndRef.current]
        return segAudioStartRef.current + (last.onsetBeat + last.durationBeats - segBaseBeatRef.current) * spb
      }

      const finish = () => {
        if (stoppedRef.current) return
        stoppedRef.current = true
        clearScheduler()
        setState((s) => ({ ...s, isPlaying: false }))
        onCompleteRef.current?.()
      }

      // ── 前瞻调度：每 25ms 把未来 LOOKAHEAD_S 内的音符写入音频时钟 ──────
      const tick = () => {
        if (stoppedRef.current) return
        const eng = getAudioEngine()
        const now = eng.currentTime
        const base = segBaseBeatRef.current
        const segEndIdx = segEndRef.current

        while (cursorRef.current <= segEndIdx) {
          const e = evts[cursorRef.current]
          const when = segAudioStartRef.current + (e.onsetBeat - base) * spb
          if (when > now + LOOKAHEAD_S) break
          const dur = Math.max(0.08, e.durationBeats * spb)
          for (const m of e.midis) {
            eng.noteOn(m, {
              when: Math.max(when, now + 0.004),
              duration: dur,
              velocity: e.hand === 'left' ? 0.52 : 0.78,
              preset,
            })
          }
          cursorRef.current += 1
        }

        // 段落播放完毕 → 循环重绕 或 结束
        if (now >= segEndWhen() + TAIL_S) {
          if (loopRef.current) {
            const s = segStartRef.current
            cursorRef.current = s
            visIdxRef.current = s
            segBaseBeatRef.current = evts[s].onsetBeat
            const nextStart = segAudioStartRef.current + (evts[segEndIdx].onsetBeat + evts[segEndIdx].durationBeats - evts[s].onsetBeat) * spb
            segAudioStartRef.current = nextStart
            segWallStartRef.current = performance.now() / 1000 + (nextStart - eng.currentTime)
          } else {
            finish()
          }
        }
      }

      // ── 视觉指针：rAF 推进高亮 / 小节 / onEvent 回调 ────────────────────
      const visTick = () => {
        if (stoppedRef.current) return
        const nowWall = performance.now() / 1000
        const elapsedBeats = (nowWall - segWallStartRef.current) / spb
        const base = segBaseBeatRef.current
        const segEndIdx = segEndRef.current

        let vi = visIdxRef.current
        while (vi <= segEndIdx && evts[vi].onsetBeat <= base + elapsedBeats) {
          onEventRef.current?.(evts[vi], vi)
          vi += 1
        }

        if (vi > visIdxRef.current) {
          visIdxRef.current = vi
          const lastIdx = Math.max(segStartRef.current, vi - 1)
          setState((s) => ({
            ...s,
            currentMeasure: evts[lastIdx]?.measure ?? s.currentMeasure,
            currentIndex: Math.min(vi, segEndIdx),
            playedUpTo: vi - 1,
          }))
        }

        // currentTime 节流到 ~12fps，避免 60fps setState 重渲染风暴
        if (nowWall - lastVisTimeRef.current > 0.08) {
          lastVisTimeRef.current = nowWall
          setState((s) => ({ ...s, currentTime: Math.max(0, nowWall - segWallStartRef.current) }))
        }

        rafRef.current = requestAnimationFrame(visTick)
      }

      tick()
      timerRef.current = window.setInterval(tick, TICK_MS)
      rafRef.current = requestAnimationFrame(visTick)
      setState((s) => ({ ...s, isPlaying: true, currentIndex: idx, currentMeasure: evts[idx].measure }))
    },
    [clearScheduler, secondsPerBeat, volume, preset, countIn, beatsPerMeasure],
  )

  const toggle = useCallback(() => {
    if (state.isPlaying) stop()
    else play()
  }, [state.isPlaying, play, stop])

  const setLoop = useCallback((loop: [number, number] | null) => {
    loopRef.current = loop
    setState((s) => ({ ...s, loop }))
  }, [])

  // 卸载时停止一切
  useEffect(
    () => () => {
      stoppedRef.current = true
      clearScheduler()
    },
    [clearScheduler],
  )

  return {
    ...state,
    events,
    play,
    stop,
    toggle,
    setLoop,
    secondsPerBeat,
    beatsPerMeasure,
  }
}

export default usePiecePlayer
