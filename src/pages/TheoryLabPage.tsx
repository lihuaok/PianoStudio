/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * TheoryLabPage.tsx — 互动乐理实验室
 * 六个交互式训练器：音程 / 和弦 / 音阶 / 调号 / 节奏 / 视奏听辨。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  CHORDS,
  KEY_SIGNATURES,
  SCALES,
  buildChord,
  buildScale,
  chordById,
  intervalInfo,
  midiToName,
  midiToFrequency,
  scaleById,
} from '@/core/music'
import { getAudioEngine } from '@/audio/audioEngine'
import { PianoKeyboard } from '@/components/PianoKeyboard'
import { recordLesson, type UserProgress } from '@/core/progress'
import './TheoryLabPage.css'

type Trainer = 'interval' | 'chord' | 'scale' | 'key' | 'rhythm' | 'sight'

interface Props {
  progress: UserProgress
  onRefresh: () => void
}

const TRAINERS: Array<{ id: Trainer; name: string; icon: string; desc: string }> = [
  { id: 'interval', name: '音程听辨', icon: '🎯', desc: '听声音，认出音程距离' },
  { id: 'chord', name: '和弦性质', icon: '🎹', desc: '三和弦 / 七和弦的听感与结构' },
  { id: 'scale', name: '音阶构建', icon: '📈', desc: '从主音出发搭建音阶' },
  { id: 'key', name: '调号识别', icon: '🔑', desc: '五线谱调号的读写' },
  { id: 'rhythm', name: '节奏型', icon: '🥁', desc: '附点、切分与三连音' },
  { id: 'sight', name: '视奏训练', icon: '👁️', desc: '看谱弹奏，随机短句' },
]

export function TheoryLabPage({ progress, onRefresh }: Props) {
  const [trainer, setTrainer] = useState<Trainer>('interval')
  const [stats, setStats] = useState({ right: 0, wrong: 0 })

  const reset = useCallback(() => setStats({ right: 0, wrong: 0 }), [])
  const record = useCallback(
    (ok: boolean) => {
      setStats((s) => ({ right: s.right + (ok ? 1 : 0), wrong: s.wrong + (ok ? 0 : 1) }))
      recordLesson(`theory_${trainer}`, ok)
      onRefresh()
    },
    [trainer, onRefresh],
  )

  const total = stats.right + stats.wrong
  const accuracy = total ? Math.round((stats.right / total) * 100) : 0

  return (
    <div className="theory-page">
      {/* 训练器选择 */}
      <div className="trainer-grid stagger">
        {TRAINERS.map((t) => (
          <button
            key={t.id}
            className={`trainer-card card card-hover${trainer === t.id ? ' is-active' : ''}`}
            onClick={() => {
              setTrainer(t.id)
              reset()
            }}
          >
            <div className="tc-icon">{t.icon}</div>
            <div className="tc-name">{t.name}</div>
            <div className="tc-desc tiny">{t.desc}</div>
          </button>
        ))}
      </div>

      {/* 成绩条 */}
      <div className="lab-scorebar">
        <div className="ls-stat">
          <span className="ls-value" style={{ color: 'var(--success)' }}>
            {stats.right}
          </span>
          <span className="ls-label tiny">答对</span>
        </div>
        <div className="ls-stat">
          <span className="ls-value" style={{ color: 'var(--danger)' }}>
            {stats.wrong}
          </span>
          <span className="ls-label tiny">答错</span>
        </div>
        <div className="ls-stat">
          <span className="ls-value" style={{ color: 'var(--amber-2)' }}>
            {accuracy}%
          </span>
          <span className="ls-label tiny">正确率</span>
        </div>
        <div className="spacer" />
        <button className="btn btn-ghost btn-sm" onClick={reset}>
          重置
        </button>
      </div>

      {/* 训练器主体 */}
      <div className="lab-body">
        {trainer === 'interval' && <IntervalTrainer onAnswer={record} />}
        {trainer === 'chord' && <ChordTrainer onAnswer={record} />}
        {trainer === 'scale' && <ScaleTrainer onAnswer={record} />}
        {trainer === 'key' && <KeySignatureTrainer onAnswer={record} />}
        {trainer === 'rhythm' && <RhythmTrainer onAnswer={record} />}
        {trainer === 'sight' && <SightReadingTrainer />}
      </div>
    </div>
  )
}

// ── 音程听辨 ────────────────────────────────────────────────────────────────
function IntervalTrainer({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const [question, setQuestion] = useState(() => makeIntervalQuestion())
  const [answered, setAnswered] = useState<string | null>(null)

  const replay = () => {
    const e = getAudioEngine()
    void e.unlock()
    const t0 = e.currentTime + 0.05
    e.noteOn(question.root, { when: t0, duration: 0.7, velocity: 0.75, preset: 'grand' })
    e.noteOn(question.root + question.semitones, { when: t0 + 0.8, duration: 0.9, velocity: 0.75, preset: 'grand' })
    if (question.harmonic) {
      e.noteOn(question.root, { when: t0 + 1.8, duration: 1.2, velocity: 0.7 })
      e.noteOn(question.root + question.semitones, { when: t0 + 1.8, duration: 1.2, velocity: 0.7 })
    }
  }

  useEffect(() => {
    const t = window.setTimeout(replay, 260)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question])

  const choose = (opt: string) => {
    if (answered) return
    setAnswered(opt)
    onAnswer(opt === question.label)
  }

  return (
    <div className="trainer-panel">
      <div className="tp-head">
        <div>
          <h3 className="subtitle">音程听辨</h3>
          <p className="small">先听两个音（先后弹奏），然后选出它们的音程名称</p>
        </div>
        <button className="btn btn-primary" onClick={replay}>
          🔊 重新播放
        </button>
      </div>

      <div className="interval-display">
        <div className="id-notes">
          <span className="id-note">{midiToName(question.root)}</span>
          <span className="id-arrow">→</span>
          <span className="id-note">{midiToName(question.root + question.semitones)}</span>
        </div>
        {answered && (
          <div className={`id-verdict${answered === question.label ? ' is-correct' : ''}`}>
            {answered === question.label ? '✓ 正确！' : `✗ 正确答案：${question.label}`}
            <span className="id-expl">{question.explanation}</span>
          </div>
        )}
      </div>

      <div className="opt-grid">
        {question.options.map((opt) => (
          <button
            key={opt}
            className={`opt-btn${answered === opt ? (opt === question.label ? ' is-correct' : ' is-wrong') : ''}${
              answered && opt === question.label ? ' is-answer' : ''
            }`}
            onClick={() => choose(opt)}
            disabled={!!answered}
          >
            {opt}
          </button>
        ))}
      </div>

      <div className="tp-foot">
        <button
          className="btn"
          onClick={() => {
            setQuestion(makeIntervalQuestion())
            setAnswered(null)
          }}
        >
          下一题 →
        </button>
      </div>
    </div>
  )
}

function makeIntervalQuestion() {
  const pool = [1, 2, 3, 4, 5, 7, 8, 9, 10, 12]
  const semitones = pool[Math.floor(Math.random() * pool.length)]
  const root = 60 + Math.floor(Math.random() * 5)
  const info = intervalInfo(semitones)
  const distractors = pool
    .filter((s) => s !== semitones)
    .map((s) => intervalInfo(s).shortZh)
  const options = [info.shortZh, ...distractors.slice(0, 3).sort(() => Math.random() - 0.5)].sort(() => Math.random() - 0.5)
  const qualities = ['纯', '大', '小', '增', '减']
  const q = qualities.find((x) => info.shortZh.startsWith(x)) ?? ''
  return {
    root,
    semitones,
    label: info.shortZh,
    options,
    harmonic: Math.random() > 0.5,
    explanation: `${info.shortZh} = ${info.degree} 度${info.quality}音程，${info.consonant ? '协和音程' : '不协和音程'}（${semitones} 个半音，根音 ${midiToName(root)} → ${midiToName(root + semitones)}）${q ? `，${q}音程` : ''}。`,
  }
}

// ── 和弦性质 ────────────────────────────────────────────────────────────────
function ChordTrainer({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const [question, setQuestion] = useState(() => makeChordQuestion())
  const [answered, setAnswered] = useState<string | null>(null)

  const play = (harmonic = false) => {
    const e = getAudioEngine()
    void e.unlock()
    const midis = buildChord(question.root, question.chordId)
    const t0 = e.currentTime + 0.05
    if (harmonic) {
      for (const m of midis) e.noteOn(m, { when: t0, duration: 1.5, velocity: 0.65 })
    } else {
      midis.forEach((m, i) => e.noteOn(m, { when: t0 + i * 0.55, duration: 0.9, velocity: 0.72 }))
    }
  }

  useEffect(() => {
    const t = window.setTimeout(() => play(false), 240)
    return () => window.clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question])

  const choose = (opt: string) => {
    if (answered) return
    setAnswered(opt)
    onAnswer(opt === question.label)
  }

  return (
    <div className="trainer-panel">
      <div className="tp-head">
        <div>
          <h3 className="subtitle">和弦性质</h3>
          <p className="small">听辨和弦的类型（依次弹奏每个音）</p>
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => play(false)}>
            🔊 分解
          </button>
          <button className="btn btn-sm" onClick={() => play(true)}>
            🔊 和弦
          </button>
        </div>
      </div>

      <div className="chord-display">
        <PianoKeyboard
          lowMidi={48}
          highMidi={76}
          targetMidis={new Set(buildChord(question.root, question.chordId))}
          height={92}
          disabled
        />
        {answered && (
          <div className={`id-verdict${answered === question.label ? ' is-correct' : ''}`}>
            {answered === question.label ? '✓ 正确！' : `✗ 正确答案：${question.label}`}
            <span className="id-expl">{question.explanation}</span>
          </div>
        )}
      </div>

      <div className="opt-grid">
        {question.options.map((opt) => (
          <button
            key={opt}
            className={`opt-btn${answered === opt ? (opt === question.label ? ' is-correct' : ' is-wrong') : ''}${
              answered && opt === question.label ? ' is-answer' : ''
            }`}
            onClick={() => choose(opt)}
            disabled={!!answered}
          >
            {opt}
          </button>
        ))}
      </div>

      <div className="tp-foot">
        <button
          className="btn"
          onClick={() => {
            setQuestion(makeChordQuestion())
            setAnswered(null)
          }}
        >
          下一题 →
        </button>
      </div>
    </div>
  )
}

function makeChordQuestion() {
  const root = 48 + Math.floor(Math.random() * 14)
  const chord = CHORDS[Math.floor(Math.random() * CHORDS.length)]
  const others = CHORDS.filter((c) => c.id !== chord.id)
    .slice(0, 3)
    .sort(() => Math.random() - 0.5)
  const options = [chord.name, ...others.map((c) => c.name)].sort(() => Math.random() - 0.5)
  return {
    root,
    chordId: chord.id,
    label: chord.name,
    options,
    explanation: `${midiToName(root)} ${chord.name}：${buildChord(root, chord.id).map((m) => midiToName(m)).join('–')}，音程结构 ${chord.intervals.join('-')}（根音起算的半音数）→ ${chord.nameEn}。`,
  }
}

// ── 音阶构建 ────────────────────────────────────────────────────────────────
function ScaleTrainer({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const [scaleId, setScaleId] = useState('major')
  const [root, setRoot] = useState(60)
  const [guess, setGuess] = useState<number[]>([])
  const [checked, setChecked] = useState(false)

  const target = useMemo(() => buildScale(root, scaleId), [root, scaleId])

  const playScale = () => {
    const e = getAudioEngine()
    void e.unlock()
    const t0 = e.currentTime + 0.05
    buildScale(root, scaleId).forEach((m, i) =>
      e.noteOn(m, { when: t0 + i * 0.22, duration: 0.5, velocity: 0.72 }),
    )
  }

  const addNote = (midi: number) => {
    if (checked) return
    setGuess((g) => (g.includes(midi) ? g.filter((x) => x !== midi) : [...g, midi].sort((a, b) => a - b)))
  }

  const check = () => {
    setChecked(true)
    const ok = guess.length === target.length && guess.every((m, i) => m === target[i])
    onAnswer(ok)
  }

  const resetQ = () => {
    setGuess([])
    setChecked(false)
  }

  const randomize = () => {
    setRoot(55 + Math.floor(Math.random() * 8))
    resetQ()
  }

  return (
    <div className="trainer-panel">
      <div className="tp-head">
        <div>
          <h3 className="subtitle">音阶构建</h3>
          <p className="small">选择音阶类型与主音，然后依次点击键盘上的正确音</p>
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={playScale}>
            🔊 听示范
          </button>
          <button className="btn btn-sm" onClick={randomize}>
            🎲 换一题
          </button>
        </div>
      </div>

      <div className="scale-config">
        <div className="sc-row">
          <span className="tiny">音阶类型</span>
          <div className="chip-row">
            {SCALES.map((s) => (
              <button
                key={s.id}
                className={`chip${scaleId === s.id ? ' is-active' : ''}`}
                onClick={() => {
                  setScaleId(s.id)
                  resetQ()
                }}
              >
                {s.name}
              </button>
            ))}
          </div>
        </div>
        <div className="sc-row">
          <span className="tiny">主音</span>
          <div className="chip-row">
            {[55, 57, 59, 60, 62, 64, 65].map((r) => (
              <button key={r} className={`chip${root === r ? ' is-active' : ''}`} onClick={() => { setRoot(r); resetQ() }}>
                {midiToName(r)}
              </button>
            ))}
          </div>
        </div>
        <div className="sc-formula">
          <span className="tiny">音程公式</span>
          <span className="mono">{scaleById(scaleId).formula}</span>
          <span className="tiny">{scaleById(scaleId).description}</span>
        </div>
      </div>

      <PianoKeyboard
        lowMidi={48}
        highMidi={76}
        targetMidis={new Set([...target, ...guess])}
        correctMidis={checked ? new Set(target) : new Set()}
        wrongMidis={checked ? new Set(guess.filter((m) => !target.includes(m))) : new Set()}
        pressedMidis={new Set(guess)}
        height={110}
        showNoteNames
        onNoteOn={addNote}
      />

      <div className="scale-answer">
        <div className="sa-slots">
          {target.map((m, i) => {
            const filled = guess[i]
            const isRight = checked && filled === m
            const isWrong = checked && filled !== undefined && filled !== m
            return (
              <div key={i} className={`sa-slot${isRight ? ' is-right' : ''}${isWrong ? ' is-wrong' : ''}`}>
                {filled !== undefined ? midiToName(filled) : '·'}
              </div>
            )
          })}
        </div>
        <div className="sa-actions">
          <button className="btn btn-ghost btn-sm" onClick={resetQ}>
            清空
          </button>
          {!checked ? (
            <button className="btn btn-primary btn-sm" onClick={check} disabled={guess.length !== target.length}>
              检查
            </button>
          ) : (
            <button className="btn btn-sm" onClick={resetQ}>
              继续
            </button>
          )}
        </div>
      </div>

      {checked && (
        <div className={`id-verdict${guess.every((m, i) => m === target[i]) ? ' is-correct' : ''}`}>
          {guess.every((m, i) => m === target[i]) ? '✓ 完全正确！' : '✗ 有偏差'}
          <span className="id-expl">
            {midiToName(root)} {scaleById(scaleId).name}：{target.map((m) => midiToName(m)).join(' – ')}
          </span>
        </div>
      )}
    </div>
  )
}

// ── 调号识别 ────────────────────────────────────────────────────────────────
function KeySignatureTrainer({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const keys = useMemo(() => Object.entries(KEY_SIGNATURES).filter(([, v]) => v.sharps.length + v.flats.length > 0), [])
  const [question, setQuestion] = useState(() => keys[Math.floor(Math.random() * keys.length)][0])
  const [answered, setAnswered] = useState<string | null>(null)

  useEffect(() => {
    setQuestion(keys[Math.floor(Math.random() * keys.length)][0])
    setAnswered(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const info = KEY_SIGNATURES[question]
  const isFlats = info.flats.length > 0

  const playScale = () => {
    const e = getAudioEngine()
    void e.unlock()
    // 用该调的 I 级音阶演示
    const rootMidi = 48 + ['C', 'G', 'D', 'A', 'E', 'F', 'B', 'A', 'E', 'D', 'A', 'D', 'E'].indexOf(info.tonic) + (isFlats ? 0 : 0)
    const start = rootMidi >= 0 ? rootMidi : 57
    const t0 = e.currentTime + 0.05
    buildScale(start, 'major').forEach((m, i) => e.noteOn(m, { when: t0 + i * 0.2, duration: 0.5, velocity: 0.7 }))
  }

  return (
    <div className="trainer-panel">
      <div className="tp-head">
        <div>
          <h3 className="subtitle">调号识别</h3>
          <p className="small">读出这个调号的调名</p>
        </div>
        <button className="btn btn-primary" onClick={playScale}>
          🔊 听该调音阶
        </button>
      </div>

      <div className="key-display">
        <div className="kd-staff">
          <div className="kd-lines">
            {Array.from({ length: 5 }, (_, i) => (
              <div key={i} className="kd-line" />
            ))}
          </div>
          <div className="kd-accidentals">
            {isFlats
              ? info.flats.map((l, i) => (
                  <span key={i} className="kd-acc" style={{ left: 20 + i * 26, top: accTop(l, isFlats) }}>
                    ♭
                  </span>
                ))
              : info.sharps.map((l, i) => (
                  <span key={i} className="kd-acc" style={{ left: 20 + i * 26, top: accTop(l, isFlats) }}>
                    ♯
                  </span>
                ))}
          </div>
        </div>
        <div className="kd-info">
          {answered && (
            <div className={`id-verdict${answered === info.label ? ' is-correct' : ''}`}>
              {answered === info.label ? '✓ 正确！' : `✗ 正确是：${info.label}`}
              <span className="id-expl">
                {info.label}：{isFlats ? `${info.flats.length} 个降号（${info.flats.join(' ')}）` : `${info.sharps.length} 个升号（${info.sharps.join(' ')}）`}
                ，顺序遵循「{isFlats ? 'B E A D G C F' : 'F C G D A E B'}」。
              </span>
            </div>
          )}
        </div>
      </div>

      <div className="opt-grid">
        {keys.slice(0, 8).map(([k]) => (
          <button
            key={k}
            className={`opt-btn${answered === KEY_SIGNATURES[k].label ? ' is-correct' : ''}${
              answered && answered !== KEY_SIGNATURES[k].label && answered === KEY_SIGNATURES[k].label ? ' is-wrong' : ''
            }${answered === k ? ' is-answer' : ''}`}
            onClick={() => {
              if (answered) return
              const label = KEY_SIGNATURES[k].label
              setAnswered(label)
              onAnswer(label === info.label)
            }}
            disabled={!!answered}
          >
            {KEY_SIGNATURES[k].label}
          </button>
        ))}
      </div>

      <div className="tp-foot">
        <button
          className="btn"
          onClick={() => {
            setQuestion(keys[Math.floor(Math.random() * keys.length)][0])
            setAnswered(null)
          }}
        >
          下一题 →
        </button>
      </div>
    </div>
  )
}

/** 升降号在五线谱上的纵向位置（粗略） */
function accTop(letter: string, isFlats: boolean): number {
  const orderFlat = ['B', 'E', 'A', 'D', 'G', 'C', 'F']
  const orderSharp = ['F', 'C', 'G', 'D', 'A', 'E', 'B']
  const order = isFlats ? orderFlat : orderSharp
  const i = order.indexOf(letter)
  const base = isFlats ? [14, 30, 6, 22, 38, 14, 30] : [30, 14, 38, 22, 6, 30, 14]
  return base[i] ?? 20
}

// ── 节奏型 ──────────────────────────────────────────────────────────────────
function RhythmTrainer({ onAnswer }: { onAnswer: (ok: boolean) => void }) {
  const [question, setQuestion] = useState(() => makeRhythmQuestion())
  const [playing, setPlaying] = useState(false)
  const [litIndex, setLitIndex] = useState(-1)

  const play = () => {
    const e = getAudioEngine()
    void e.unlock()
    setPlaying(true)
    setLitIndex(-1)
    const t0 = e.currentTime + 0.15
    const spb = 60 / 80
    question.steps.forEach((s, i) => {
      const when = t0 + s.start * spb
      if (s.rest) {
        setTimeout(() => setLitIndex(i), Math.max(0, (when - e.currentTime) * 1000))
        return
      }
      e.click(when, i === 0)
      // 用音高区别：第一个音高八度
      e.noteOn(60 + (i === 0 ? 12 : 0), { when, duration: 0.16, velocity: 0.75, preset: 'soft' })
      setTimeout(() => setLitIndex(i), Math.max(0, (when - e.currentTime) * 1000))
    })
    setTimeout(
      () => setPlaying(false),
      (question.steps[question.steps.length - 1].start + 1) * spb * 1000 + 400,
    )
  }

  const [answered, setAnswered] = useState<string | null>(null)

  return (
    <div className="trainer-panel">
      <div className="tp-head">
        <div>
          <h3 className="subtitle">节奏型听辨</h3>
          <p className="small">听节奏，选出它的正确记谱法</p>
        </div>
        <button className="btn btn-primary" onClick={play} disabled={playing}>
          {playing ? '🔊 播放中…' : '🔊 播放节奏'}
        </button>
      </div>

      <div className="rhythm-display">
        {question.steps.map((s, i) => (
          <div
            key={i}
            className={`rh-step${litIndex === i ? ' is-lit' : ''}${s.rest ? ' is-rest' : ''}${s.dur === 3 ? ' is-long' : ''}`}
            style={{ flex: s.dur }}
          >
            {s.rest ? '𝄽' : '●'}
          </div>
        ))}
      </div>

      <div className="opt-grid">
        {question.options.map((opt) => (
          <button
            key={opt}
            className={`opt-btn opt-mono${answered === opt ? (opt === question.label ? ' is-correct' : ' is-wrong') : ''}${
              answered && opt === question.label ? ' is-answer' : ''
            }`}
            onClick={() => {
              if (answered) return
              setAnswered(opt)
              onAnswer(opt === question.label)
            }}
            disabled={!!answered}
          >
            {opt}
          </button>
        ))}
      </div>

      {answered && (
        <div className={`id-verdict${answered === question.label ? ' is-correct' : ''}`}>
          {answered === question.label ? '✓ 正确！' : `✗ 正确答案：${question.label}`}
          <span className="id-expl">{question.explain}</span>
        </div>
      )}

      <div className="tp-foot">
        <button
          className="btn"
          onClick={() => {
            setQuestion(makeRhythmQuestion())
            setAnswered(null)
          }}
        >
          下一题 →
        </button>
      </div>
    </div>
  )
}

function makeRhythmQuestion() {
  type Step = { start: number; dur: number; rest: boolean }
  const patterns: Array<{ steps: Step[]; label: string; explain: string; alts: string[] }> = [
    {
      steps: [
        { start: 0, dur: 1, rest: false },
        { start: 1, dur: 2, rest: false },
      ],
      label: '♩ + ♪.',
      explain: '一个四分音符加一个附点八分音符（附点 = 原值的一半）。感觉是「长—短」。',
      alts: ['♪ + ♩', '♩ + ♩', '♩.+ ♩', '♪ + ♩.'],
    },
    {
      steps: [
        { start: 0, dur: 2, rest: false },
        { start: 2, dur: 1, rest: false },
      ],
      label: '♪ + ♩',
      explain: '一个八分音符加一个四分音符（两个八分之和）。感觉是「短—长」。',
      alts: ['♩ + ♪.', '♩ + ♩', '♪ + ♪', '♩. + ♪'],
    },
    {
      steps: [
        { start: 0, dur: 1, rest: false },
        { start: 1, dur: 1, rest: false },
        { start: 2, dur: 1, rest: true },
      ],
      label: '♪ + 𝄽 + ♪',
      explain: '两个八分音符 + 一个八分休止。总时值是一个附点四分音符的三分之二——切分感来自重音落在第二拍。',
      alts: ['♪ + ♪ + 𝄽', '♩ + 𝄽 + ♪', '♪ + 𝄽 + ♩', '𝄽 + ♪ + ♪'],
    },
    {
      steps: [
        { start: 0, dur: 2, rest: false },
        { start: 2, dur: 1, rest: false },
        { start: 3, dur: 1, rest: false },
      ],
      label: '♪ + ♩ + ♪',
      explain: '八分 + 四分 + 八分。这是 3/8 拍里非常典型的节奏型，也是《致爱丽丝》里大量出现的组合。',
      alts: ['♩ + ♪ + ♪', '♪ + ♪ + ♩', '♩ + ♩ + ♩', '♪ + ♩ + ♩'],
    },
    {
      steps: [
        { start: 0, dur: 3, rest: false },
        { start: 3, dur: 3, rest: false },
      ],
      label: '♩. + ♩.',
      explain: '两个附点四分音符 = 3/8 一小节。每小节两个这样的音符就是《致爱丽丝》的基本脉搏。',
      alts: ['♩ + ♩ + ♩', '♩. + ♩', '♪ + ♩.', '♩ + ♪.'],
    },
  ]
  const p = patterns[Math.floor(Math.random() * patterns.length)]
  const options = [p.label, ...p.alts.slice(0, 3)].sort(() => Math.random() - 0.5)
  return { ...p, options }
}

// ── 视奏训练 ────────────────────────────────────────────────────────────────
function SightReadingTrainer() {
  const [phrase, setPhrase] = useState(() => randomPhrase())
  const [revealed, setRevealed] = useState(false)

  const engine = getAudioEngine()

  return (
    <div className="trainer-panel">
      <div className="tp-head">
        <div>
          <h3 className="subtitle">视奏训练</h3>
          <p className="small">先看谱 3 秒，然后凭记忆在键盘上弹出——这是视谱能力最直接的训练</p>
        </div>
        <div className="row">
          <button className="btn btn-sm" onClick={() => { setPhrase(randomPhrase()); setRevealed(false) }}>
            🎲 换一句
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              void engine.unlock()
              const t0 = engine.currentTime + 0.05
              phrase.forEach((m, i) => engine.noteOn(m, { when: t0 + i * 0.35, duration: 0.4, velocity: 0.7 }))
            }}
          >
            🔊 示范
          </button>
        </div>
      </div>

      <div className="sight-display">
        {phrase.map((m, i) => (
          <div key={i} className={`sight-note${revealed ? '' : ' is-hidden'}`}>
            {revealed ? midiToName(m) : '?'}
          </div>
        ))}
      </div>

      <div className="tp-foot" style={{ justifyContent: 'center' }}>
        <button className="btn btn-primary btn-lg" onClick={() => setRevealed(true)}>
          {revealed ? '再练一次' : '揭晓答案'}
        </button>
      </div>

      <PianoKeyboard
        lowMidi={55}
        highMidi={79}
        targetMidis={new Set(phrase)}
        height={120}
        showNoteNames
        onNoteOn={(m, v) => {
          void engine.unlock()
          engine.noteOn(m, { velocity: v, duration: 0.3 })
          window.setTimeout(() => engine.noteOff(m), 320)
        }}
      />
    </div>
  )
}

function randomPhrase(): number[] {
  // 从简单音阶片段构造：保证可弹
  const patterns: number[][] = [
    [60, 62, 64, 65, 64, 62],
    [60, 64, 67, 65, 64, 60],
    [62, 64, 65, 67, 65, 64],
    [60, 62, 64, 67, 65, 62],
    [65, 64, 62, 60, 62, 65],
    [60, 67, 65, 64, 62, 60],
  ]
  const base = patterns[Math.floor(Math.random() * patterns.length)]
  const shift = Math.floor(Math.random() * 5)
  return base.map((m) => m + shift)
}

export default TheoryLabPage
