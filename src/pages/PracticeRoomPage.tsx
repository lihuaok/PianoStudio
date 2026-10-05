/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * PracticeRoomPage.tsx — 自由练习室
 * 全键盘 + 实时音准/力度反馈 + 麦克风音高检测 + 和弦/音阶快速调用 + 简易评测。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { PianoKeyboard } from '@/components/PianoKeyboard'
import { getAudioEngine, PRESETS, type PianoPreset } from '@/audio/audioEngine'
import { useMetronome } from '@/audio/useMetronome'
import { ComputerKeyboardInput, MidiInput, MicrophoneInput, buildKeyboard } from '@/core/input'
import { SCALES, CHORDS, buildChord, buildScale, midiToName } from '@/core/music'
import { recordSession, type UserProgress } from '@/core/progress'
import type { InputSource } from '@/core/evaluator'
import './PracticeRoomPage.css'

interface Props {
  progress: UserProgress
  onRefresh: () => void
}

type Mode = 'free' | 'scale' | 'chord' | 'eval'

export function PracticeRoomPage({ progress, onRefresh }: Props) {
  const [mode, setMode] = useState<Mode>('free')
  const [lowMidi, setLowMidi] = useState(48)
  const [highMidi, setHighMidi] = useState(84)
  const [preset, setPreset] = useState<PianoPreset>('grand')
  const [volume, setVolume] = useState(0.8)
  const [sustain, setSustain] = useState(false)
  const [octaveShift, setOctaveShift] = useState(0)

  const [inputSource, setInputSource] = useState<InputSource>('onScreen')
  const [status, setStatus] = useState('')

  // 麦克风实时反馈
  const [micLevel, setMicLevel] = useState(0)
  const [micFreq, setMicFreq] = useState(0)
  const [micMidi, setMicMidi] = useState<number | null>(null)
  const [micCents, setMicCents] = useState(0)

  // 评测
  const [evalTargets, setEvalTargets] = useState<number[]>([])
  const [evalIdx, setEvalIdx] = useState(0)
  const [evalHits, setEvalHits] = useState<boolean[]>([])
  const [evalRunning, setEvalRunning] = useState(false)
  const [evalStart, setEvalStart] = useState(0)

  const [lastNotes, setLastNotes] = useState<Array<{ midi: number; time: number }>>([])
  const [targetHint, setTargetHint] = useState<number | null>(null)

  const engine = getAudioEngine()
  const metro = useMetronome({ bpm: 72, beatsPerMeasure: 3, accentFirst: true, volume: 0.45, soundOn: false })
  const [metroOn, setMetroOn] = useState(false)

  useEffect(() => {
    engine.setMasterVolume(volume)
  }, [engine, volume])

  const pressedRef = useRef<Set<number>>(new Set())
  const [pressed, setPressed] = useState<Set<number>>(new Set())

  const noteOn = useCallback(
    (midi: number, velocity: number) => {
      void engine.unlock()
      engine.noteOn(midi, { velocity, preset })
      pressedRef.current.add(midi)
      setPressed(new Set(pressedRef.current))
      setLastNotes((n) => [...n.slice(-19), { midi, time: performance.now() / 1000 }])

      // 评测模式判定
      if (mode === 'eval' && evalTargets.length > 0) {
        const want = evalTargets[evalIdx]
        setEvalHits((h) => [...h, midi === want])
        if (midi === want) {
          setEvalIdx((i) => {
            const next = i + 1
            if (next >= evalTargets.length) {
              setEvalRunning(false)
              return 0
            }
            return next
          })
        }
      }
    },
    [engine, preset, mode, evalTargets, evalIdx],
  )

  const noteOff = useCallback(
    (midi: number) => {
      engine.noteOff(midi)
      pressedRef.current.delete(midi)
      setPressed(new Set(pressedRef.current))
    },
    [engine],
  )

  // 踏板
  useEffect(() => {
    engine.setSustainPedal(sustain)
  }, [engine, sustain])

  // 音阶 / 和弦
  const [scaleId, setScaleId] = useState('major')
  const [chordId, setChordId] = useState('maj')
  const [rootMidi, setRootMidi] = useState(60)

  const activeScale = useMemo(() => (mode === 'scale' ? buildScale(rootMidi + octaveShift * 12, scaleId) : []), [mode, rootMidi, scaleId, octaveShift])
  const activeChord = useMemo(() => (mode === 'chord' ? buildChord(rootMidi + octaveShift * 12, chordId) : []), [mode, rootMidi, chordId, octaveShift])
  const hintMidis = useMemo(() => new Set(mode === 'scale' ? activeScale : mode === 'chord' ? activeChord : []), [mode, activeScale, activeChord])

  const playActive = () => {
    void engine.unlock()
    const seq = mode === 'scale' ? activeScale : mode === 'chord' ? activeChord : []
    if (!seq.length) return
    const t0 = engine.currentTime + 0.06
    seq.forEach((m, i) => engine.noteOn(m, { when: t0 + i * 0.2, duration: 0.6, velocity: 0.74, preset }))
  }

  // 输入源
  const computerRef = useRef<ComputerKeyboardInput | null>(null)
  const midiRef = useRef<MidiInput | null>(null)
  const micRef = useRef<MicrophoneInput | null>(null)
  const targetRef = useRef<number | null>(null)
  targetRef.current = mode === 'eval' && evalTargets.length ? evalTargets[evalIdx] : null

  // 电脑键盘弹奏：常驻启用，基准 C4，随八度移调（Z–M 低音区 / Q–P 高音区）
  useEffect(() => {
    const kbd = new ComputerKeyboardInput(60 + octaveShift * 12, {
      onNote: () => {},
      onNoteOn: (m, v) => noteOn(m, v),
      onNoteOff: (m) => noteOff(m),
    })
    kbd.attach()
    computerRef.current = kbd
    return () => { kbd.detach(); computerRef.current = null }
  }, [octaveShift, noteOn, noteOff])

  useEffect(() => {
    if (inputSource !== 'midi') { midiRef.current?.disconnect(); midiRef.current = null; return }
    const m = new MidiInput({
      onNote: () => {},
      onNoteOn: (midi, v) => noteOn(midi, v),
      onNoteOff: (midi) => noteOff(midi),
      onStatus: (msg) => setStatus(msg),
    })
    void m.connect()
    midiRef.current = m
    return () => { m.disconnect(); midiRef.current = null }
  }, [inputSource, noteOn, noteOff])

  useEffect(() => {
    if (inputSource !== 'mic') {
      micRef.current?.stop()
      micRef.current = null
      setMicMidi(null)
      return
    }
    const mic = new MicrophoneInput({
      onNote: () => {},
      onNoteOn: (midi, v) => noteOn(midi, Math.min(0.85, v * 1.6)),
      onNoteOff: (midi) => noteOff(midi),
      onLevel: (level, freq, midi) => {
        setMicLevel(level)
        setMicFreq(freq)
        setMicMidi(midi)
        if (midi !== null && targetRef.current !== null) {
          const targetFreq = 440 * Math.pow(2, (targetRef.current - 69) / 12)
          setMicCents(Math.round(1200 * Math.log2(freq / targetFreq)))
        }
      },
      onStatus: (msg) => setStatus(msg),
    })
    void mic.start()
    micRef.current = mic
    return () => { mic.stop(); micRef.current = null }
  }, [inputSource, noteOn, noteOff])

  // 评测生成
  const generateEval = () => {
    const pool: number[] = []
    for (let m = lowMidi; m <= highMidi; m++) pool.push(m)
    const len = 10
    const seq = Array.from({ length: len }, () => pool[Math.floor(Math.random() * pool.length)])
    setEvalTargets(seq)
    setEvalHits([])
    setEvalIdx(0)
    setEvalStart(performance.now())
    setEvalRunning(true)
  }

  const evalScore = evalHits.length ? Math.round((evalHits.filter(Boolean).length / evalTargets.length) * 100) : 0
  const evalDone = evalHits.length >= evalTargets.length && evalTargets.length > 0

  const finishEval = () => {
    if (!evalTargets.length) return
    recordSession({
      id: `free_${Date.now()}`,
      targetId: 'practice_room',
      targetName: '练习室 · 随机音高',
      startedAt: evalStart,
      durationSeconds: Math.max(5, Math.round((performance.now() - evalStart) / 1000)),
      score: evalScore,
      hand: 'both',
      bpm: 0,
      deviceId: 'local',
    })
    onRefresh()
  }

  useEffect(() => {
    if (evalDone) finishEval()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evalDone])

  const { whiteCount } = useMemo(() => buildKeyboard(lowMidi + octaveShift * 12, highMidi + octaveShift * 12), [lowMidi, highMidi, octaveShift])

  // 电脑键盘键位提示（随八度移调）
  const keyLabels = useMemo(() => ComputerKeyboardInput.keyLabelsFor(60 + octaveShift * 12), [octaveShift])

  return (
    <div className="practice-page">
      {/* 模式切换 */}
      <div className="pr-modes">
        {(
          [
            ['free', '🎹 自由弹奏'],
            ['scale', '📈 音阶练习'],
            ['chord', '🎹 和弦练习'],
            ['eval', '🎯 音高训练'],
          ] as Array<[Mode, string]>
        ).map(([m, label]) => (
          <button key={m} className={`pr-mode${mode === m ? ' is-active' : ''}`} onClick={() => setMode(m)}>
            {label}
          </button>
        ))}
        <div className="spacer" />
        {status && <span className="tiny" style={{ color: 'var(--text-4)', fontStyle: 'italic' }}>{status}</span>}
      </div>

      {/* 工具条 */}
      <div className="pr-toolbar card">
        <div className="prt-group">
          <label className="tiny">输入</label>
          <div className="seg">
            {([['onScreen', '屏幕'], ['midi', 'MIDI'], ['mic', '麦克风']] as Array<[InputSource, string]>).map(([k, l]) => (
              <button key={k} className={`seg-btn${inputSource === k ? ' is-active' : ''}`} onClick={() => setInputSource(k)}>
                {l}
              </button>
            ))}
          </div>
        </div>

        <div className="prt-group">
          <label className="tiny">音色</label>
          <select className="select" value={preset} onChange={(e) => setPreset(e.target.value as PianoPreset)}>
            {Object.entries(PRESETS).map(([k, v]) => (
              <option key={k} value={k}>{v.label}</option>
            ))}
          </select>
        </div>

        <div className="prt-group">
          <label className="tiny">音量</label>
          <input type="range" className="range" min={0} max={100} value={volume * 100} onChange={(e) => setVolume(+e.target.value / 100)} />
        </div>

        <div className="prt-group">
          <label className="tiny">八度</label>
          <div className="octave-ctl">
            <button className="btn btn-icon btn-sm" onClick={() => setOctaveShift((o) => Math.max(-2, o - 1))}>−</button>
            <span className="mono">{octaveShift >= 0 ? `+${octaveShift}` : octaveShift}</span>
            <button className="btn btn-icon btn-sm" onClick={() => setOctaveShift((o) => Math.min(2, o + 1))}>+</button>
          </div>
        </div>

        <div className="prt-group">
          <label className="tiny">辅助</label>
          <div className="toggle-row">
            <button
              className={`tgl${sustain ? ' is-on' : ''}`}
              onClick={() => setSustain(!sustain)}
            >
              🦶 延音踏板
            </button>
            <button
              className={`tgl${metroOn ? ' is-on' : ''}`}
              onClick={() => { setMetroOn(!metroOn); metroOn ? metro.stop() : metro.toggle() }}
            >
              🥁 节拍器
            </button>
          </div>
        </div>
      </div>

      {/* 音阶 / 和弦配置 */}
      {(mode === 'scale' || mode === 'chord') && (
        <div className="pr-config card">
          <div className="pcfg-row">
            <span className="tiny">{mode === 'scale' ? '音阶' : '和弦'}</span>
            <div className="chip-row">
              {mode === 'scale'
                ? SCALES.map((s) => (
                    <button key={s.id} className={`chip${scaleId === s.id ? ' is-active' : ''}`} onClick={() => setScaleId(s.id)}>
                      {s.name}
                    </button>
                  ))
                : CHORDS.map((c) => (
                    <button key={c.id} className={`chip${chordId === c.id ? ' is-active' : ''}`} onClick={() => setChordId(c.id)}>
                      {c.name}
                    </button>
                  ))}
            </div>
          </div>
          <div className="pcfg-row">
            <span className="tiny">主音</span>
            <div className="chip-row">
              {[48, 50, 52, 53, 55, 57, 59, 60, 62, 64, 65].map((r) => (
                <button key={r} className={`chip${rootMidi === r ? ' is-active' : ''}`} onClick={() => setRootMidi(r)}>
                  {midiToName(r)}
                </button>
              ))}
            </div>
            <button className="btn btn-sm btn-primary" onClick={playActive}>
              ▶ 播放
            </button>
          </div>
        </div>
      )}

      {/* 麦克风实时面板 */}
      {inputSource === 'mic' && (
        <div className="mic-panel card">
          <div className="mp-left">
            <div className="mp-label tiny">输入电平</div>
            <div className="mp-meter">
              <div className="mp-meter-fill" style={{ width: `${Math.min(100, micLevel * 130)}%` }} />
            </div>
          </div>
          <div className="mp-mid">
            <div className="mp-label tiny">检测频率</div>
            <div className="mp-value mono">{micFreq > 0 ? `${micFreq.toFixed(1)} Hz` : '—'}</div>
          </div>
          <div className="mp-note">
            <div className="mp-label tiny">识别音高</div>
            <div className="mp-note-value">{micMidi !== null ? midiToName(micMidi) : '—'}</div>
            {targetRef.current !== null && micMidi !== null && (
              <div className={`mp-cents${Math.abs(micCents) < 12 ? ' is-good' : Math.abs(micCents) < 35 ? ' is-ok' : ' is-bad'}`}>
                {micCents > 0 ? '+' : ''}{micCents} 音分
                {Math.abs(micCents) < 12 && ' ✓ 音准良好'}
              </div>
            )}
          </div>
        </div>
      )}

      {/* 评测面板 */}
      {mode === 'eval' && (
        <div className="eval-panel card">
          <div className="ep-head">
            <div>
              <h3 className="subtitle">音高训练</h3>
              <p className="small">随机生成 10 个音，在键盘上依次弹出</p>
            </div>
            <div className="spacer" />
            {!evalRunning ? (
              <button className="btn btn-primary" onClick={generateEval}>
                {evalTargets.length ? '再来一组' : '开始训练'}
              </button>
            ) : (
              <span className="mono tiny">
                {evalIdx + 1} / {evalTargets.length}
              </span>
            )}
          </div>

          {evalTargets.length > 0 && (
            <>
              <div className="ep-target">
                <span className="tiny">当前目标音</span>
                <span className="ep-target-value">{midiToName(evalTargets[evalIdx] ?? evalTargets[0])}</span>
              </div>
              <div className="ep-progress">
                {evalTargets.map((t, i) => (
                  <span key={i} className={`ep-dot${i < evalHits.length ? (evalHits[i] ? ' is-right' : ' is-wrong') : i === evalIdx ? ' is-current' : ''}`} />
                ))}
              </div>
              {evalDone && (
                <div className="ep-result">
                  <span className="ep-score" style={{ color: evalScore >= 80 ? 'var(--success)' : evalScore >= 50 ? 'var(--amber-3)' : 'var(--danger)' }}>
                    {evalScore}
                  </span>
                  <span className="small">
                    答对 {evalHits.filter(Boolean).length} / {evalTargets.length}
                  </span>
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 键盘 */}
      <div className="pr-keyboard">
        <div className="prk-head">
          <span className="tiny mono">
            {midiToName(lowMidi + octaveShift * 12)} – {midiToName(highMidi + octaveShift * 12)} · {whiteCount} 个白键
          </span>
          <div className="spacer" />
          <input
            type="range"
            className="range"
            style={{ maxWidth: 160 }}
            min={24}
            max={72}
            value={lowMidi}
            onChange={(e) => {
              const v = +e.target.value
              setLowMidi(v)
              if (highMidi < v + 12) setHighMidi(v + 12)
            }}
          />
          <span className="tiny">音域</span>
        </div>
        <PianoKeyboard
          lowMidi={lowMidi + octaveShift * 12}
          highMidi={highMidi + octaveShift * 12}
          targetMidis={hintMidis}
          currentMidi={mode === 'eval' ? evalTargets[evalIdx] ?? null : null}
          pressedMidis={pressed}
          keyLabels={keyLabels}
          height={150}
          showNoteNames
          showOctaves
          onNoteOn={noteOn}
          onNoteOff={noteOff}
        />
      </div>

      {/* 最近弹奏 */}
      {lastNotes.length > 0 && (
        <div className="recent card">
          <div className="rc-label tiny">最近弹奏</div>
          <div className="rc-list">
            {lastNotes.slice().reverse().map((n, i) => (
              <span key={i} className="rc-note">
                {midiToName(n.midi)}
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="tiny" style={{ color: 'var(--text-4)', textAlign: 'center' }}>
        累计练习 {Math.round(progress.totalPracticeSeconds / 60)} 分钟 ·{' '}
        共 {progress.sessions.length} 次记录 · 数据自动保存在本机，可在「设置」中开启跨设备同步
      </div>
    </div>
  )
}

export default PracticeRoomPage
