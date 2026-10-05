/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * PianoKeyboard.tsx — 可弹奏虚拟钢琴键盘
 *
 * 特性：
 *  - 多点触控（mousedown/touchstart + pointer events）
 *  - 滑奏（glissando）：按住一个键横向拖过可连续触发
 *  - 目标音高提示：待弹的音会显示为半透明高亮
 *  - 实时反馈：弹错的音短暂变红，弹对的变绿
 *  - 力度：点击位置（键上部力度大）或键盘事件携带的 velocity
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { isBlackKey } from '@/core/music'
import './PianoKeyboard.css'

export interface KeyboardFeedback {
  midi: number
  status: 'idle' | 'pending' | 'correct' | 'wrong' | 'current'
}

export interface PianoKeyboardProps {
  lowMidi?: number
  highMidi?: number
  /** 要提示的目标音（不显示提示） */
  targetMidis?: Set<number>
  /** 已正确弹奏的音 */
  correctMidis?: Set<number>
  /** 当前正在等待的音 */
  currentMidi?: number | null
  /** 弹错的音（短暂显示） */
  wrongMidis?: Set<number>
  /** 按下的音（视觉反馈） */
  pressedMidis?: Set<number>
  disabled?: boolean
  /** 指法标注显示 */
  showFingerHints?: boolean
  fingerHints?: Map<number, number>
  /** 音符名称标注 */
  showNoteNames?: boolean
  /** 电脑键盘键位提示：midi → 键帽名（如 'Q'、'2'） */
  keyLabels?: Map<number, string>
  onNoteOn?: (midi: number, velocity: number) => void
  onNoteOff?: (midi: number) => void
  height?: number
  /** 显示八度分隔标记 */
  showOctaves?: boolean
}

interface KeyInfo {
  midi: number
  isBlack: boolean
  whiteIndex: number
}

export function PianoKeyboard({
  lowMidi = 48,
  highMidi = 84,
  targetMidis,
  correctMidis,
  currentMidi,
  wrongMidis,
  pressedMidis,
  disabled = false,
  showFingerHints = false,
  fingerHints,
  showNoteNames = false,
  keyLabels,
  onNoteOn,
  onNoteOff,
  height = 130,
  showOctaves = false,
}: PianoKeyboardProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [localPressed, setLocalPressed] = useState<Set<number>>(new Set())
  const pointerNotes = useRef<Map<number, number>>(new Map()) // pointerId → midi
  const mouseDownRef = useRef(false)

  const { keys, whiteCount } = useMemo(() => {
    const arr: KeyInfo[] = []
    let wi = 0
    for (let m = lowMidi; m <= highMidi; m++) {
      const black = isBlackKey(m)
      arr.push({ midi: m, isBlack: black, whiteIndex: black ? wi - 1 : wi++ })
    }
    return { keys: arr, whiteCount: wi }
  }, [lowMidi, highMidi])

  const whiteKeys = keys.filter((k) => !k.isBlack)
  const blackKeys = keys.filter((k) => k.isBlack)

  const whiteW = 100 / whiteCount
  const blackW = whiteW * 0.62
  const keyH = height
  const blackH = keyH * 0.62

  const active = useMemo(() => {
    const s = new Set(pressedMidis ?? [])
    for (const p of localPressed) s.add(p)
    return s
  }, [pressedMidis, localPressed])

  // ── 坐标 → 音 ────────────────────────────────────────────────────────────
  // 修复：键位以百分比定位（left: i*whiteW%），命中判定必须先把像素 x 归一化
  // 为同一百分比坐标系；旧实现直接拿像素 x 除以百分比值，容器宽度 ≠100px 时
  // 全部错位（点左半边几乎都触发最右键、黑键区失灵）。
  const midiAtPoint = useCallback(
    (clientX: number, clientY: number): number | null => {
      const el = containerRef.current
      if (!el) return null
      const rect = el.getBoundingClientRect()
      const x = clientX - rect.left
      const y = clientY - rect.top
      if (x < 0 || x > rect.width || y < 0 || y > keyH) return null
      const xPct = (x / rect.width) * 100

      // 先检测黑键（黑键在上层，优先级更高）
      for (const bk of blackKeys) {
        const left = (bk.whiteIndex + 1) * whiteW - blackW / 2
        if (xPct >= left && xPct <= left + blackW && y <= blackH) return bk.midi
      }
      // 否则取白键
      const wi = Math.floor(xPct / whiteW)
      const white = whiteKeys[Math.max(0, Math.min(whiteKeys.length - 1, wi))]
      return white ? white.midi : null
    },
    [blackKeys, whiteKeys, whiteW, blackW, blackH, keyH],
  )

  // 力度：由点击高度决定（越靠上越强）
  const velocityAt = useCallback((clientY: number): number => {
    const el = containerRef.current
    if (!el) return 0.7
    const rect = el.getBoundingClientRect()
    const ratio = (clientY - rect.top) / keyH
    return Math.max(0.15, Math.min(1, 0.45 + ratio * 0.55))
  }, [keyH])

  const press = useCallback(
    (midi: number, velocity: number) => {
      if (disabled) return
      setLocalPressed((prev) => new Set(prev).add(midi))
      onNoteOn?.(midi, velocity)
    },
    [disabled, onNoteOn],
  )

  const release = useCallback(
    (midi: number) => {
      setLocalPressed((prev) => {
        if (!prev.has(midi)) return prev
        const next = new Set(prev)
        next.delete(midi)
        return next
      })
      onNoteOff?.(midi)
    },
    [onNoteOff],
  )

  // ── Pointer 事件（支持多点触控与滑奏）────────────────────────────────────
  const onPointerDown = (e: React.PointerEvent) => {
    if (disabled) return
    const midi = midiAtPoint(e.clientX, e.clientY)
    if (midi === null) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointerNotes.current.set(e.pointerId, midi)
    press(midi, velocityAt(e.clientY))
  }

  const onPointerMove = (e: React.PointerEvent) => {
    if (disabled) return
    const cur = pointerNotes.current.get(e.pointerId)
    if (cur === undefined) return
    const midi = midiAtPoint(e.clientX, e.clientY)
    if (midi !== null && midi !== cur) {
      // 滑奏：释放旧音，触发新音
      release(cur)
      pointerNotes.current.set(e.pointerId, midi)
      press(midi, velocityAt(e.clientY))
    }
  }

  const onPointerUp = (e: React.PointerEvent) => {
    const cur = pointerNotes.current.get(e.pointerId)
    if (cur !== undefined) {
      release(cur)
      pointerNotes.current.delete(e.pointerId)
    }
  }

  // 防止拖拽选中 / 触屏滚动
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const prevent = (e: Event) => e.preventDefault()
    el.addEventListener('touchstart', prevent, { passive: false })
    el.addEventListener('touchmove', prevent, { passive: false })
    el.addEventListener('contextmenu', prevent)
    return () => {
      el.removeEventListener('touchstart', prevent)
      el.removeEventListener('touchmove', prevent)
      el.removeEventListener('contextmenu', prevent)
    }
  }, [])

  useEffect(() => {
    mouseDownRef.current = false
  }, [])

  const keyClass = (k: KeyInfo) => {
    const cls = ['pk-key', k.isBlack ? 'pk-black' : 'pk-white']
    if (active.has(k.midi)) cls.push('is-pressed')
    if (wrongMidis?.has(k.midi)) cls.push('is-wrong')
    else if (correctMidis?.has(k.midi)) cls.push('is-correct')
    else if (currentMidi === k.midi) cls.push('is-current')
    else if (targetMidis?.has(k.midi)) cls.push('is-target')
    if (disabled) cls.push('is-disabled')
    return cls.join(' ')
  }

  return (
    <div className="piano-keyboard-wrap">
      <div
        ref={containerRef}
        className={`piano-keyboard${disabled ? ' is-disabled' : ''}`}
        style={{ height: keyH }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerLeave={(e) => {
          if (e.buttons === 0) return
          onPointerUp(e)
        }}
      >
        {/* 白键 */}
        {whiteKeys.map((k, i) => (
          <div
            key={k.midi}
            className={keyClass(k)}
            style={{ left: `${i * whiteW}%`, width: `${whiteW}%`, height: keyH }}
            data-midi={k.midi}
          >
            <div className="pk-face">
              {(showNoteNames || showFingerHints || keyLabels) && (
                <div className="pk-labels">
                  {showFingerHints && fingerHints?.has(k.midi) && (
                    <span className="pk-finger">{fingerHints.get(k.midi)}</span>
                  )}
                  {keyLabels?.get(k.midi) && <span className="pk-keycap">{keyLabels.get(k.midi)}</span>}
                  {showNoteNames && (
                    <span className="pk-name">{k.midi % 12 === 0 ? `C${k.midi / 12 - 1}` : ''}</span>
                  )}
                </div>
              )}
              {showOctaves && k.midi % 12 === 0 && <div className="pk-octave">C{k.midi / 12 - 1}</div>}
            </div>
          </div>
        ))}

        {/* 黑键 */}
        {blackKeys.map((k) => {
          const left = (k.whiteIndex + 1) * whiteW - blackW / 2
          return (
            <div
              key={k.midi}
              className={keyClass(k)}
              style={{ left: `${left}%`, width: `${blackW}%`, height: blackH }}
              data-midi={k.midi}
            >
              <div className="pk-face">
                {showFingerHints && fingerHints?.has(k.midi) && (
                  <span className="pk-finger pk-finger-black">{fingerHints.get(k.midi)}</span>
                )}
                {keyLabels?.get(k.midi) && (
                  <span className="pk-keycap pk-keycap-black">{keyLabels.get(k.midi)}</span>
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export default PianoKeyboard
