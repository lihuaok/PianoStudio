/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * ScoreView.tsx — SVG 大谱表渲染器（高音表 + 低音表）
 *
 * 几何约定（与 core/score.ts 保持一致）：
 *   每个谱表以「顶线 y=0」为局部原点，向下为正。
 *   五线位于 y = 0, s, 2s, 3s, 4s（s = lineSpacing）
 *   音符 y 由 trebleY()/bassY() 给出，已含谱表归属判定。
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { layoutScore, measureTicks, type LaidOutNote, type Piece } from '@/core/score'
import { midiToName } from '@/core/music'
import './ScoreView.css'

export interface ScoreViewProps {
  piece: Piece
  measureRange?: [number, number]
  currentMeasure?: number
  currentNoteKey?: string | null
  correctKeys?: Set<string>
  wrongKeys?: Set<string>
  showFingering?: boolean
  showNoteNames?: boolean
  compact?: boolean
  width?: number
  onNoteClick?: (note: LaidOutNote['note']) => void
  highlightMeasures?: Set<number>
}

const STAFF_LINES = 5

export function ScoreView({
  piece,
  measureRange,
  currentMeasure,
  currentNoteKey,
  correctKeys,
  wrongKeys,
  showFingering = true,
  showNoteNames = false,
  compact = false,
  width = 1180,
  onNoteClick,
  highlightMeasures,
}: ScoreViewProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoverKey, setHoverKey] = useState<string | null>(null)

  const s = compact ? 8 : 10
  const measureGap = compact ? 14 : 20
  const staffGap = compact ? 44 : 54

  const scopedPiece = useMemo<Piece>(() => {
    if (!measureRange) return piece
    const [start, end] = measureRange
    return {
      ...piece,
      measures: piece.measures.filter((m) => m.index >= start && m.index <= end),
      notes: piece.notes.filter((n) => n.measure >= start && n.measure <= end),
      totalMeasures: end - start + 1,
    }
  }, [piece, measureRange])

  const layout = useMemo(
    () =>
      layoutScore(scopedPiece, {
        staffSpacing: s,
        measureGap,
        systemGap: staffGap,
        pageWidth: width,
        leftPad: 34,
        rightPad: 30,
        showFingering,
        compact,
      }),
    [scopedPiece, s, measureGap, staffGap, width, showFingering, compact],
  )

  const ticksPerMeasure = measureTicks(piece.timeSignature)
  const staffH = s * (STAFF_LINES - 1)
  const noteKey = (n: { measure: number; onset: number; hand: string }) =>
    `${n.measure}-${Math.round(n.onset)}-${n.hand}`

  // 自动滚动到当前小节
  useEffect(() => {
    if (currentMeasure === undefined || !containerRef.current) return
    const el = containerRef.current
    const target = el.querySelector(`[data-measure="${currentMeasure}"]`)
    if (!target) return
    const top = (target as HTMLElement).offsetTop
    el.scrollTo({ top: Math.max(0, top - el.clientHeight / 3), behavior: 'smooth' })
  }, [currentMeasure])

  // ── 单个音符 ────────────────────────────────────────────────────────────
  const renderNote = (ln: LaidOutNote, staffTop: number) => {
    const key = noteKey(ln.note)
    const y = ln.y
    const x = ln.noteHeadX
    const isCurrent = currentNoteKey === key
    const isCorrect = correctKeys?.has(key)
    const isWrong = wrongKeys?.has(key)
    const isHover = hoverKey === key

    const status = isWrong ? 'wrong' : isCorrect ? 'correct' : isCurrent ? 'current' : 'idle'

    const dur = ln.note.duration
    const isWhole = dur >= ticksPerMeasure * 0.98
    const isHalf = dur >= ticksPerMeasure * 0.49 && dur < ticksPerMeasure * 0.98
    const isQuarter = dur >= ticksPerMeasure * 0.24 && dur < ticksPerMeasure * 0.49
    const stemLen = s * 3.4
    const up = ln.stemUp
    const stemX = x + (up ? s * 0.68 : -s * 0.68)
    const chordMidis = ln.note.chord ?? [ln.note.midi]

    // 加线（谱表外）
    const ledgers: number[] = []
    if (y < 0) {
      for (let ly = -s; ly >= y - 0.1; ly -= s) ledgers.push(ly)
    } else if (y > staffH) {
      for (let ly = staffH + s; ly <= y + 0.1; ly += s) ledgers.push(ly)
    }

    return (
      <g
        key={key}
        className={`sv-note sv-${status}${isHover ? ' is-hover' : ''}`}
        transform={`translate(0 ${staffTop})`}
        onClick={() => onNoteClick?.(ln.note)}
        onMouseEnter={() => setHoverKey(key)}
        onMouseLeave={() => setHoverKey(null)}
        style={{ cursor: onNoteClick ? 'pointer' : 'default' }}
      >
        <rect x={x - 8} y={y - s * 1.7} width={18} height={s * 3.4} fill="transparent" />

        {ledgers.map((ly, i) => (
          <line key={i} x1={x - s * 1.05} y1={ly} x2={x + s * 1.05} y2={ly} className="sv-ledger-line" strokeWidth={1.1} />
        ))}

        {/* 升降号 */}
        {ln.accidental.type !== 'none' && (
          <text x={x - s * 1.35} y={y + s * 0.38} className="sv-accidental" fontSize={s * 2.2}>
            {ln.accidental.type === 'sharp' ? '♯' : '♭'}
          </text>
        )}

        {/* 符干 */}
        {!isWhole && (
          <line x1={stemX} y1={y} x2={stemX} y2={y + (up ? -stemLen : stemLen)} className="sv-stem" strokeWidth={1.25} />
        )}

        {/* 符尾 */}
        {isQuarter && (
          <path
            d={
              up
                ? `M ${stemX} ${y - stemLen} q ${s * 1.0} ${s * 1.1} 0 ${s * 2.2}`
                : `M ${stemX} ${y + stemLen} q ${-s * 1.0} ${s * 1.1} 0 ${s * 2.2}`
            }
            className="sv-flag"
            strokeWidth={1.5}
            fill="none"
          />
        )}

        {/* 符头 */}
        <ellipse
          cx={x}
          cy={y}
          rx={s * (isHalf ? 0.95 : 0.82)}
          ry={s * 0.5}
          className={`sv-head sv-head-${status}`}
          strokeWidth={1.4}
        />

        {/* 和弦其余音 */}
        {chordMidis.slice(1).map((m, i) => {
          const dir = m > ln.note.midi ? 1 : -1
          const cy = y + dir * s
          return (
            <g key={m}>
              <line x1={stemX} y1={cy} x2={stemX} y2={cy + (up ? -stemLen : stemLen)} className="sv-stem" strokeWidth={1.25} />
              <ellipse cx={x} cy={cy} rx={s * 0.82} ry={s * 0.5} className="sv-head sv-head-idle" strokeWidth={1.4} />
            </g>
          )
        })}

        {/* 指法 */}
        {showFingering && ln.note.finger !== undefined && !ln.note.isChord && (
          <text x={up ? x + s * 1.25 : x - s * 1.25} y={y - s * 0.85} className="sv-finger" fontSize={s * 1.3}>
            {ln.note.finger}
          </text>
        )}

        {/* 音名 */}
        {showNoteNames && (
          <text x={x} y={y + s * 2.4} className="sv-notename" fontSize={s * 1.05}>
            {midiToName(ln.note.midi)}
          </text>
        )}

        {/* 力度 */}
        {ln.note.dynamic && (
          <text x={x - s * 0.9} y={y + s * 2.6} className="sv-dynamic" fontSize={s * 1.35}>
            {ln.note.dynamic}
          </text>
        )}
      </g>
    )
  }

  // ── 系统行 ──────────────────────────────────────────────────────────────
  const renderSystem = (system: (typeof layout.systems)[number], sysIdx: number) => {
    const trebleTop = system.y
    const bassTop = system.y + staffH + staffGap

    return (
      <g key={sysIdx}>
        <StaffLines x={0} y={trebleTop} width={width} s={s} />
        <StaffLines x={0} y={bassTop} width={width} s={s} />
        {/* 大谱表连线 */}
        <line x1={0} y1={trebleTop} x2={0} y2={bassTop + staffH} className="sv-brace" strokeWidth={1.5} />

        {/* 谱号 */}
        <text x={3} y={trebleTop + s * 3.5} className="sv-clef" fontSize={s * 4.4}>
          𝄞
        </text>
        <text x={3} y={bassTop + s * 3.3} className="sv-clef" fontSize={s * 4.1}>
          𝄢
        </text>
        {/* 拍号 */}
        <text x={19} y={trebleTop + s * 2.4} className="sv-timesig" fontSize={s * 1.8}>
          {piece.timeSignature[0]}
        </text>
        <text x={19} y={trebleTop + s * 4.3} className="sv-timesig" fontSize={s * 1.8}>
          {piece.timeSignature[1]}
        </text>

        {/* 小节内容 */}
        {system.measures.map((m, mi) => {
          const isCurrent = currentMeasure !== undefined && m.measure.index === currentMeasure
          const isHi = highlightMeasures?.has(m.measure.index)
          return (
            <g key={mi} data-measure={m.measure.index}>
              {(isCurrent || isHi) && (
                <rect
                  x={m.x - 4}
                  y={trebleTop - s * 1.4}
                  width={m.width + 4}
                  height={staffH * 2 + staffGap + s * 2.8}
                  className={`sv-measure-bg${isCurrent ? ' is-current' : ''}`}
                  rx={5}
                />
              )}

              {m.measure.chordSymbol && (
                <text x={m.x + 3} y={trebleTop - s * 1.9} className="sv-roman" fontSize={s * 1.35}>
                  {m.measure.chordSymbol}
                </text>
              )}

              {m.notes.map((ln) =>
                ln.useBass ? renderNote(ln, bassTop) : renderNote(ln, trebleTop),
              )}

              {/* 小节线（两谱表 + 中间竖线） */}
              <line x1={m.x + m.width} y1={trebleTop} x2={m.x + m.width} y2={trebleTop + staffH} className="sv-barline" strokeWidth={1.2} />
              <line x1={m.x + m.width} y1={bassTop} x2={m.x + m.width} y2={bassTop + staffH} className="sv-barline" strokeWidth={1.2} />
            </g>
          )
        })}

        {/* 起始小节线 */}
        {system.measures[0] && (
          <line x1={system.measures[0].x} y1={trebleTop} x2={system.measures[0].x} y2={trebleTop + staffH} className="sv-barline" strokeWidth={1.2} />
        )}
        {system.measures[0] && (
          <line x1={system.measures[0].x} y1={bassTop} x2={system.measures[0].x} y2={bassTop + staffH} className="sv-barline" strokeWidth={1.2} />
        )}

        {/* 小节号 */}
        <text x={system.measures[0]?.x ?? 0} y={trebleTop - s * 0.6} className="sv-measure-no" fontSize={s * 1.2}>
          {system.startMeasure}
        </text>
      </g>
    )
  }

  return (
    <div className={`score-view${compact ? ' is-compact' : ''}`} ref={containerRef}>
      <svg width={width} height={layout.height} viewBox={`0 0 ${width} ${layout.height}`} className="score-svg">
        {layout.systems.map(renderSystem)}
      </svg>
    </div>
  )
}

function StaffLines({ x, y, width, s }: { x: number; y: number; width: number; s: number }) {
  return (
    <g>
      {Array.from({ length: STAFF_LINES }, (_, i) => (
        <line key={i} x1={x} y1={y + i * s} x2={x + width} y2={y + i * s} className="sv-staff-line" strokeWidth={0.9} />
      ))}
    </g>
  )
}

export default ScoreView
