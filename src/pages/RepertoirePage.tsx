/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * RepertoirePage.tsx — 曲目库（《致爱丽丝》分章精讲）
 *
 * 三大模式：
 *   聆听  — 示范播放 + 乐谱跟随 + 教学讲解
 *   跟弹  — 示范播放，你跟着弹，即时反馈
 *   评测  — 录制你的演奏，实时评分并给出改进建议
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { furElise, sections, TEACHING_TIPS, practiceSequence, notesOfSection } from '@/data/furElise'
import type { PieceSection } from '@/core/score'
import { ScoreView } from '@/components/ScoreView'
import { PianoKeyboard } from '@/components/PianoKeyboard'
import { getAudioEngine, PRESETS, type PianoPreset } from '@/audio/audioEngine'
import { usePiecePlayer } from '@/audio/usePiecePlayer'
import { useMetronome } from '@/audio/useMetronome'
import { ComputerKeyboardInput, MidiInput, MicrophoneInput } from '@/core/input'
import { evaluate, scoreGrade, buildTargets, type PlayedNote, type EvaluationResult, type InputSource } from '@/core/evaluator'
import { recordSession, type UserProgress } from '@/core/progress'
import { midiToName } from '@/core/music'
import type { ViewId } from '@/App'
import './RepertoirePage.css'

type Mode = 'listen' | 'follow' | 'evaluate'

interface Props {
  progress: UserProgress
  onRefresh: () => void
}

export function RepertoirePage({ progress, onRefresh }: Props) {
  const [sectionId, setSectionId] = useState(sections[0].id)
  const section = useMemo(() => sections.find((s) => s.id === sectionId) ?? sections[0], [sectionId])

  // 乐谱宽度跟随视口：窄屏自动收窄（SVG 仍按固定宽度排版并横向滚动）
  const [scoreWidth, setScoreWidth] = useState(1180)
  useEffect(() => {
    const update = () => {
      const w = window.innerWidth
      setScoreWidth(w < 700 ? 760 : w < 1100 ? 980 : 1180)
    }
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  const [mode, setMode] = useState<Mode>('listen')
  const [hand, setHand] = useState<'right' | 'left' | 'both'>('right')
  const [bpm, setBpm] = useState(section.bpm)
  const [volume, setVolume] = useState(0.8)
  const [preset, setPreset] = useState<PianoPreset>('grand')
  const [showFingering, setShowFingering] = useState(true)
  const [showNoteNames, setShowNoteNames] = useState(false)
  const [loopEnabled, setLoopEnabled] = useState(true)

  const [metronomeOn, setMetronomeOn] = useState(false)
  const [metronomeVolume, setMetronomeVolume] = useState(0.5)

  const [inputSource, setInputSource] = useState<InputSource>('onScreen')
  const [statusMsg, setStatusMsg] = useState('')

  // 跟弹/评测状态
  const [currentTargetIdx, setCurrentTargetIdx] = useState(0)
  const [correctKeys, setCorrectKeys] = useState<Set<string>>(new Set())
  const [wrongKeys, setWrongKeys] = useState<Set<string>>(new Set())
  const [currentNoteKey, setCurrentNoteKey] = useState<string | null>(null)
  const [recorded, setRecorded] = useState<PlayedNote[]>([])
  const [result, setResult] = useState<EvaluationResult | null>(null)
  const [pressStart, setPressStart] = useState<number>(0)

  const engine = getAudioEngine()
  const player = usePiecePlayer({
    piece: furElise,
    bpm,
    measureRange: [section.startMeasure, section.endMeasure],
    hand: mode === 'listen' ? hand : hand,
    volume,
    preset,
    countIn: mode !== 'listen',
    onEvent: (e, i) => {
      if (mode === 'follow' || mode === 'evaluate') {
        setCurrentTargetIdx(i)
      }
    },
  })

  const metro = useMetronome({
    bpm,
    beatsPerMeasure: furElise.timeSignature[0],
    accentFirst: true,
    volume: metronomeVolume,
    soundOn: metronomeOn,
  })

  // 切换章节时重置
  useEffect(() => {
    setBpm(section.bpm)
    player.stop()
    setCurrentTargetIdx(0)
    setCorrectKeys(new Set())
    setWrongKeys(new Set())
    setCurrentNoteKey(null)
    setResult(null)
    setRecorded([])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sectionId])

  useEffect(() => {
    engine.setMasterVolume(volume)
  }, [engine, volume])
  useEffect(() => {
    engine.setMetronomeVolume(metronomeVolume)
  }, [engine, metronomeVolume])

  // 循环设置
  useEffect(() => {
    player.setLoop(loopEnabled ? [section.startMeasure, section.endMeasure] : null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loopEnabled, section])

  // ── 目标音符 ────────────────────────────────────────────────────────────
  const sectionNotes = useMemo(() => notesOfSection(section), [section])
  const targets = useMemo(
    () =>
      buildTargets(sectionNotes, {
        tickPerMeasure: furElise.meta?.tickPerMeasure ?? 36,
        bpm,
        hand,
        includeOrnaments: false,
      }),
    [sectionNotes, bpm, hand],
  )

  // ── 输入源管理 ──────────────────────────────────────────────────────────
  const computerRef = useRef<ComputerKeyboardInput | null>(null)
  const midiRef = useRef<MidiInput | null>(null)
  const micRef = useRef<MicrophoneInput | null>(null)

  // 真实按压状态（修复：屏幕键盘按下时无按压视觉反馈——之前永远传空 Set）
  const pressedRef = useRef<Set<number>>(new Set())
  const [pressedKeys, setPressedKeys] = useState<Set<number>>(new Set())
  const pressKey = useCallback((m: number) => {
    if (pressedRef.current.has(m)) return
    pressedRef.current.add(m)
    setPressedKeys(new Set(pressedRef.current))
  }, [])
  const releaseKey = useCallback((m: number) => {
    if (!pressedRef.current.delete(m)) return
    setPressedKeys(new Set(pressedRef.current))
  }, [])

  const handleNotePlayed = useCallback(
    (midi: number, velocity: number, source: InputSource) => {
      if (mode === 'listen') {
        // 聆听模式下也允许自由弹奏（练手感）
        pressKey(midi)
        engine.noteOn(midi, { velocity, preset })
        window.setTimeout(() => {
          engine.noteOff(midi)
          releaseKey(midi)
        }, 320)
        return
      }

      const t = targets[currentTargetIdx]
      if (!t) return

      const entry: PlayedNote = {
        midi,
        time: (performance.now() - pressStart) / 1000,
        duration: 0.2,
        velocity,
        source,
      }

      if (midi === t.midi) {
        pressKey(midi)
        engine.noteOn(midi, { velocity, preset })
        window.setTimeout(() => {
          engine.noteOff(midi)
          releaseKey(midi)
        }, 260)
        setCorrectKeys((s) => new Set(s).add(noteKeyOf(t, currentTargetIdx)))
        setWrongKeys((s) => {
          const n = new Set(s)
          n.delete(noteKeyOf(t, currentTargetIdx))
          return n
        })
        setCurrentTargetIdx((i) => Math.min(i + 1, targets.length - 1))
        if (mode === 'evaluate') setRecorded((r) => [...r, entry])
      } else {
        pressKey(midi)
        engine.noteOn(midi, { velocity: Math.min(0.5, velocity), preset })
        window.setTimeout(() => {
          engine.noteOff(midi)
          releaseKey(midi)
        }, 140)
        setWrongKeys((s) => new Set(s).add(noteKeyOf(t, currentTargetIdx)))
        // 重新尝试同一个音
        window.setTimeout(() => setWrongKeys((s) => { const n = new Set(s); n.delete(noteKeyOf(t, currentTargetIdx)); return n }), 500)
        if (mode === 'evaluate') setRecorded((r) => [...r, entry])
      }
    },
    [mode, targets, currentTargetIdx, engine, preset, pressStart, pressKey, releaseKey],
  )

  // 电脑键盘弹奏：常驻启用，无需切换输入源（Z–M 低音区 / Q–P 高音区）
  useEffect(() => {
    const kbd = new ComputerKeyboardInput(60, {
      onNote: () => {},
      onNoteOn: (midi, vel) => {
        pressKey(midi)
        handleNotePlayed(midi, vel, 'computer')
      },
      onNoteOff: (midi) => {
        engine.noteOff(midi)
        releaseKey(midi)
      },
    })
    kbd.attach()
    computerRef.current = kbd
    return () => {
      kbd.detach()
      computerRef.current = null
    }
  }, [handleNotePlayed, engine, pressKey, releaseKey])

  // MIDI
  useEffect(() => {
    if (inputSource !== 'midi') {
      midiRef.current?.disconnect()
      midiRef.current = null
      return
    }
    const m = new MidiInput({
      onNote: () => {},
      onNoteOn: (midi, vel) => {
        pressKey(midi)
        handleNotePlayed(midi, vel, 'midi')
      },
      onNoteOff: (midi) => {
        engine.noteOff(midi)
        releaseKey(midi)
      },
      onStatus: (msg) => setStatusMsg(msg),
    })
    void m.connect()
    midiRef.current = m
    return () => {
      m.disconnect()
      midiRef.current = null
    }
  }, [inputSource, handleNotePlayed, engine, pressKey, releaseKey])

  // 麦克风
  useEffect(() => {
    if (inputSource !== 'mic') {
      micRef.current?.stop()
      micRef.current = null
      return
    }
    const mic = new MicrophoneInput({
      onNote: () => {},
      onNoteOn: (midi, vel) => {
        pressKey(midi)
        handleNotePlayed(midi, vel, 'mic')
      },
      onNoteOff: (midi) => {
        engine.noteOff(midi)
        releaseKey(midi)
      },
      onStatus: (msg) => setStatusMsg(msg),
    })
    void mic.start()
    micRef.current = mic
    return () => {
      mic.stop()
      micRef.current = null
    }
  }, [inputSource, handleNotePlayed, engine, pressKey, releaseKey])

  // ── 播放控制 ────────────────────────────────────────────────────────────
  const [playState, setPlayState] = useState({ isPlaying: false, currentTime: 0 })

  const handlePlay = useCallback(() => {
    if (player.isPlaying) {
      player.stop()
      if (mode === 'evaluate') finishEvaluation()
    } else {
      void engine.unlock()
      if (mode === 'evaluate') {
        setRecorded([])
        setResult(null)
        setPressStart(performance.now())
        setCurrentTargetIdx(0)
      } else if (mode === 'follow') {
        setCurrentTargetIdx(0)
        setCorrectKeys(new Set())
        setWrongKeys(new Set())
      }
      player.play()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [player.isPlaying, mode])

  const finishEvaluation = useCallback(() => {
    if (targets.length === 0) return
    const r = evaluate(targets, recorded, { timingTolerance: 60 / bpm / 3, gradeFingering: inputSource === 'midi' })
    setResult(r)
    const elapsed = pressStart ? (performance.now() - pressStart) / 1000 : 30
    recordSession({
      id: `sec_${section.id}_${Date.now()}`,
      targetId: section.id,
      targetName: section.name,
      startedAt: pressStart || Date.now(),
      durationSeconds: Math.max(5, Math.round(elapsed)),
      score: r.totalScore,
      hand,
      bpm,
      breakdown: {
        pitch: r.pitchScore,
        rhythm: r.rhythmScore,
        dynamics: r.dynamicsScore,
        fluency: r.fluencyScore,
        fingering: r.fingeringScore,
      },
      deviceId: 'local',
    })
    onRefresh()
  }, [targets, recorded, bpm, inputSource, section, hand, pressStart, onRefresh])

  // 跟踪播放状态，用于「播放自然结束」时自动评分
  useEffect(() => {
    if (player.isPlaying) {
      setPlayState((s) => ({ ...s, isPlaying: true }))
    } else {
      setPlayState((s) => {
        if (s.isPlaying && mode === 'evaluate') {
          // 自然播放结束
          window.setTimeout(() => finishEvaluation(), 0)
        }
        return { ...s, isPlaying: false }
      })
    }
  }, [player.isPlaying, mode, finishEvaluation])

  void playState

  // ── 键盘高亮数据 ────────────────────────────────────────────────────────
  // 防护：章节无音符时 Math.min(...[]) = Infinity，键盘范围会崩坏
  const sectionMidis = useMemo(() => sectionNotes.flatMap((n) => n.chord ?? [n.midi]), [sectionNotes])
  const keyboardLow = sectionMidis.length ? Math.min(...sectionMidis) - 2 : 48
  const keyboardHigh = sectionMidis.length ? Math.max(...sectionMidis) + 2 : 84

  // 电脑键盘键位提示（基准 C4=60，与常驻键盘输入一致）
  const keyLabels = useMemo(() => ComputerKeyboardInput.keyLabelsFor(60), [])

  const targetMidis = useMemo(() => {
    const s = new Set<number>()
    const upcoming = targets.slice(currentTargetIdx, currentTargetIdx + 8)
    for (const t of upcoming) s.add(t.midi)
    return s
  }, [targets, currentTargetIdx])

  const correctMidis = useMemo(() => {
    const s = new Set<number>()
    for (const k of correctKeys) s.add(parseKeyMidi(k))
    return s
  }, [correctKeys])

  const wrongMidis = useMemo(() => {
    const s = new Set<number>()
    for (const k of wrongKeys) s.add(parseKeyMidi(k))
    return s
  }, [wrongKeys])

  const fingerHints = useMemo(() => {
    const m = new Map<number, number>()
    for (const n of sectionNotes) if (n.finger) m.set(n.midi, n.finger)
    return m
  }, [sectionNotes])

  const secProgress = progress.sections[section.id]
  const grade = result ? scoreGrade(result.totalScore) : null
  const sectionTips = TEACHING_TIPS.filter((t) => t.measure >= section.startMeasure && t.measure <= section.endMeasure + 2)

  return (
    <div className="rep-page">
      {/* 曲目信息条 */}
      <div className="piece-banner">
        <div className="pb-left">
          <div className="pb-title">
            {furElise.titleOriginal}
            <span className="pb-cn">{furElise.title}</span>
          </div>
          <div className="pb-meta">
            {furElise.composer} · {furElise.year} · {furElise.catalog} · {furElise.key} ·{' '}
            {furElise.timeSignature.join('/')} 拍 · {furElise.tempoMark} · 共 {furElise.totalMeasures} 小节
          </div>
        </div>
        <div className="pb-right">
          <div className="pb-stat">
            <div className="pb-stat-value">{secProgress?.bestScore ?? '—'}</div>
            <div className="pb-stat-label tiny">本章节最好成绩</div>
          </div>
          <div className="pb-stat">
            <div className="pb-stat-value">{secProgress?.attempts ?? 0}</div>
            <div className="pb-stat-label tiny">练习次数</div>
          </div>
        </div>
      </div>

      {/* 章节选择 */}
      <div className="section-strip">
        {sections.map((s) => {
          const p = progress.sections[s.id]
          const active = s.id === sectionId
          return (
            <button
              key={s.id}
              className={`sec-card card${active ? ' is-active' : ''}${p?.mastered ? ' is-mastered' : ''}`}
              onClick={() => setSectionId(s.id)}
            >
              <div className="sc-form">{s.form}</div>
              <div className="sc-name">{s.name.replace(/^第 \d+ 章 · /, '')}</div>
              <div className="sc-range tiny mono">
                m{s.startMeasure}–{s.endMeasure}
              </div>
              <div className="sc-difficulty">
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} className={`diff-dot${i < s.difficulty ? ' is-on' : ''}`} />
                ))}
              </div>
              {p && (
                <div className="sc-score">
                  {p.mastered && <span className="pill pill-success">已掌握</span>}
                  {p.bestScore > 0 && <span className="pill pill-amber">{p.bestScore}</span>}
                </div>
              )}
            </button>
          )
        })}
      </div>

      {/* 章节信息 */}
      <div className="section-info">
        <div className="si-main">
          <h3 className="subtitle">{section.name}</h3>
          <p className="body" style={{ marginTop: 'var(--sp-2)' }}>
            {section.summary}
          </p>
          <div className="focus-list">
            {section.focus.map((f, i) => (
              <div key={i} className="focus-item">
                <span className="fi-check">▸</span>
                {f}
              </div>
            ))}
          </div>
        </div>
        {sectionTips.length > 0 && (
          <div className="si-tips">
            {sectionTips.slice(0, 2).map((tip, i) => (
              <div key={i} className={`tip-card tip-${tip.kind}`}>
                <div className="tip-head">
                  <span className="tip-kind">
                    {tip.kind === 'technique'
                      ? '🎹 技法'
                      : tip.kind === 'rhythm'
                        ? '🥁 节奏'
                        : tip.kind === 'theory'
                          ? '📐 乐理'
                          : tip.kind === 'warning'
                            ? '⚠️ 注意'
                            : '🎵 乐句'}
                  </span>
                  <span className="tip-title">{tip.title}</span>
                </div>
                <p className="tip-body">{tip.body}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 控制台 */}
      <div className="console card">
        <div className="console-tabs">
          {(['listen', 'follow', 'evaluate'] as Mode[]).map((m) => (
            <button key={m} className={`ctab${mode === m ? ' is-active' : ''}`} onClick={() => setMode(m)}>
              {m === 'listen' ? '🎧 聆听' : m === 'follow' ? '🎹 跟弹' : '🎯 评测'}
            </button>
          ))}
          <div className="spacer" />
          {statusMsg && <span className="console-status tiny">{statusMsg}</span>}
        </div>

        <div className="console-controls">
          <div className="ctl-group">
            <label className="ctl-label tiny">手部</label>
            <div className="seg">
              {(['right', 'left', 'both'] as const).map((h) => (
                <button key={h} className={`seg-btn${hand === h ? ' is-active' : ''}`} onClick={() => setHand(h)}>
                  {h === 'right' ? '右手' : h === 'left' ? '左手' : '双手'}
                </button>
              ))}
            </div>
          </div>

          <div className="ctl-group">
            <label className="ctl-label tiny">速度 {bpm} BPM</label>
            <input
              type="range"
              className="range"
              min={30}
              max={140}
              value={bpm}
              onChange={(e) => setBpm(+e.target.value)}
            />
          </div>

          <div className="ctl-group">
            <label className="ctl-label tiny">音量 {Math.round(volume * 100)}%</label>
            <input
              type="range"
              className="range"
              min={0}
              max={100}
              value={volume * 100}
              onChange={(e) => setVolume(+e.target.value / 100)}
            />
          </div>

          <div className="ctl-group">
            <label className="ctl-label tiny">音色</label>
            <select className="select" value={preset} onChange={(e) => setPreset(e.target.value as PianoPreset)}>
              {Object.entries(PRESETS).map(([k, v]) => (
                <option key={k} value={k}>
                  {v.label}
                </option>
              ))}
            </select>
          </div>

          <div className="ctl-group">
            <label className="ctl-label tiny">输入源</label>
            <div className="seg">
              {(
                [
                  ['onScreen', '屏幕'],
                  ['midi', 'MIDI'],
                  ['mic', '麦克风'],
                ] as Array<[InputSource, string]>
              ).map(([k, label]) => (
                <button key={k} className={`seg-btn${inputSource === k ? ' is-active' : ''}`} onClick={() => setInputSource(k)}>
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="ctl-group">
            <label className="ctl-label tiny">辅助</label>
            <div className="toggle-row">
              <button
                className={`tgl${metronomeOn ? ' is-on' : ''}`}
                onClick={() => {
                  setMetronomeOn(!metronomeOn)
                  if (!metronomeOn) metro.toggle()
                  else metro.stop()
                }}
              >
                🥁 节拍器
              </button>
              <button className={`tgl${loopEnabled ? ' is-on' : ''}`} onClick={() => setLoopEnabled(!loopEnabled)}>
                🔁 循环
              </button>
              <button className={`tgl${showFingering ? ' is-on' : ''}`} onClick={() => setShowFingering(!showFingering)}>
                1️⃣ 指法
              </button>
              <button className={`tgl${showNoteNames ? ' is-on' : ''}`} onClick={() => setShowNoteNames(!showNoteNames)}>
                🔤 音名
              </button>
            </div>
          </div>
        </div>

        {/* 传输控制 */}
        <div className="transport">
          <button className="btn btn-primary btn-lg transport-main" onClick={handlePlay}>
            {player.isPlaying ? '⏸ 停止' : mode === 'listen' ? '▶ 播放示范' : mode === 'follow' ? '▶ 开始跟弹' : '● 开始评测'}
          </button>
          <div className="transport-meta">
            <span className="mono tiny">
              {player.isPlaying ? `小节 ${player.currentMeasure}` : `共 ${section.endMeasure - section.startMeasure + 1} 小节`}
            </span>
            {mode !== 'listen' && (
              <span className="mono tiny">
                进度 {currentTargetIdx + 1} / {targets.length}
              </span>
            )}
          </div>
          {metro.isRunning && (
            <div className="beat-indicator">
              {Array.from({ length: furElise.timeSignature[0] }, (_, i) => (
                <span key={i} className={`beat-dot${metro.currentBeat === i ? ' is-active' : ''}${metro.isAccent && i === 0 ? ' is-accent' : ''}`} />
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 乐谱 */}
      <div className="score-panel">
        <ScoreView
          piece={furElise}
          measureRange={[section.startMeasure, section.endMeasure]}
          currentMeasure={mode === 'listen' ? player.currentMeasure : undefined}
          currentNoteKey={currentNoteKey}
          correctKeys={correctKeys}
          wrongKeys={wrongKeys}
          showFingering={showFingering}
          showNoteNames={showNoteNames}
          width={scoreWidth}
        />
      </div>

      {/* 键盘 */}
      <div className="keyboard-panel">
        <div className="kp-head">
          <span className="tiny">
            {mode === 'listen'
              ? '自由弹奏练习手感'
              : mode === 'follow'
                ? '跟着示范弹奏，弹对会变绿'
                : '录制演奏，结束后自动评分'}
            <span className="tiny mono" style={{ marginLeft: 'var(--sp-3)', color: 'var(--text-4)' }}>
              ⌨️ 电脑键盘始终可弹：Z–M 低音区 · Q–P 高音区
            </span>
          </span>
          <div className="spacer" />
          <span className="tiny mono">
            音域 {midiToName(keyboardLow)} – {midiToName(keyboardHigh)}
          </span>
        </div>
        <PianoKeyboard
          lowMidi={Math.max(24, keyboardLow)}
          highMidi={Math.min(108, keyboardHigh)}
          targetMidis={targetMidis}
          correctMidis={correctMidis}
          wrongMidis={wrongMidis}
          currentMidi={mode === 'listen' ? undefined : targets[currentTargetIdx]?.midi ?? null}
          pressedMidis={pressedKeys}
          keyLabels={keyLabels}
          showFingerHints={showFingering}
          fingerHints={fingerHints}
          height={140}
          onNoteOn={(midi, vel) => {
            pressKey(midi)
            handleNotePlayed(midi, vel, inputSource)
          }}
          onNoteOff={(midi) => {
            engine.noteOff(midi)
            releaseKey(midi)
          }}
        />
      </div>

      {/* 评分结果 */}
      {result && grade && (
        <div className="result-panel card anim-up">
          <div className="rp-header">
            <div className="rp-score" style={{ color: grade.color }}>
              <span className="rp-score-value">{result.totalScore}</span>
              <span className="rp-score-label tiny">总分</span>
            </div>
            <div className="rp-grade">
              <div className="rp-grade-label" style={{ color: grade.color }}>
                {grade.label}
              </div>
              <div className="rp-stars">
                {Array.from({ length: 5 }, (_, i) => (
                  <span key={i} className={i < grade.star ? 'is-on' : ''}>
                    ★
                  </span>
                ))}
              </div>
            </div>
            <div className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => setResult(null)}>
              关闭
            </button>
          </div>

          <div className="rp-summary">{result.summary}</div>

          <div className="rp-metrics">
            <MetricBar label="音高准确" value={result.pitchScore} />
            <MetricBar label="节奏准确" value={result.rhythmScore} />
            <MetricBar label="力度表现" value={result.dynamicsScore} />
            <MetricBar label="流畅连贯" value={result.fluencyScore} />
            <MetricBar label="指法正确" value={result.fingeringScore} />
          </div>

          <div className="rp-stats">
            <div className="rp-stat">
              <span className="rp-stat-v">{result.stats.correct}</span>
              <span className="rp-stat-l tiny">正确音</span>
            </div>
            <div className="rp-stat">
              <span className="rp-stat-v" style={{ color: 'var(--danger)' }}>
                {result.stats.wrongPitch}
              </span>
              <span className="rp-stat-l tiny">错音</span>
            </div>
            <div className="rp-stat">
              <span className="rp-stat-v" style={{ color: 'var(--warning)' }}>
                {result.stats.missed}
              </span>
              <span className="rp-stat-l tiny">漏音</span>
            </div>
            <div className="rp-stat">
              <span className="rp-stat-v">{result.stats.extra}</span>
              <span className="rp-stat-l tiny">多余音</span>
            </div>
            <div className="rp-stat">
              <span className="rp-stat-v">{result.stats.longestStreak}</span>
              <span className="rp-stat-l tiny">最长连击</span>
            </div>
            <div className="rp-stat">
              <span className="rp-stat-v">{result.stats.averageTimeDelta > 0 ? '+' : ''}{result.stats.averageTimeDelta}ms</span>
              <span className="rp-stat-l tiny">平均时值偏差</span>
            </div>
          </div>

          <div className="rp-advice">
            <div className="rp-advice-title">改进建议</div>
            {result.advice.map((a, i) => (
              <div key={i} className="rp-advice-item">
                <span className="ra-dot" />
                {a}
              </div>
            ))}
          </div>

          <div className="rp-judgements">
            <div className="rp-advice-title">逐音反馈（前 30 个）</div>
            <div className="judgement-list">
              {result.judgements.slice(0, 30).map((j, i) => (
                <div key={i} className={`judgement j-${j.status}`}>
                  <span className="j-icon">
                    {j.status === 'correct' ? '✓' : j.status === 'wrongPitch' ? '✗' : j.status === 'missed' ? '–' : '+'}
                  </span>
                  <span className="j-msg">{j.message}</span>
                  {j.centsOff !== undefined && j.centsOff !== 0 && (
                    <span className="j-cents tiny mono">
                      {j.centsOff > 0 ? '+' : ''}
                      {j.centsOff}¢
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function MetricBar({ label, value }: { label: string; value: number }) {
  const color = value >= 85 ? 'var(--success)' : value >= 70 ? 'var(--amber-3)' : value >= 50 ? 'var(--warning)' : 'var(--danger)'
  return (
    <div className="metric">
      <div className="metric-head">
        <span className="tiny">{label}</span>
        <span className="mono tiny" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="bar">
        <div className="bar-fill" style={{ width: `${value}%`, background: color }} />
      </div>
    </div>
  )
}

// ── 辅助 ────────────────────────────────────────────────────────────────────
function noteKeyOf(t: { measure: number; midi: number }, idx: number): string {
  return `${t.measure}-${t.midi}-${idx}`
}
function parseKeyMidi(k: string): number {
  const parts = k.split('-')
  return parseInt(parts[1], 10) || 0
}

export default RepertoirePage
