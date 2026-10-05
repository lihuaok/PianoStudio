/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * CurriculumPage.tsx — 课程体系
 * 左侧级别导航 + 课时列表 + 课时详情（含互动练习与答题）。
 */

import { useEffect, useMemo, useState } from 'react'
import { CATEGORY_META, LEVELS, LESSONS, lessonById, lessonsByLevel, type Lesson, type LessonBlock } from '@/data/curriculum'
import { recordLesson, type UserProgress } from '@/core/progress'
import { getAudioEngine } from '@/audio/audioEngine'
import { midiToName } from '@/core/music'
import { PianoKeyboard } from '@/components/PianoKeyboard'
import './CurriculumPage.css'

interface Props {
  progress: UserProgress
  onRefresh: () => void
}

export function CurriculumPage({ progress, onRefresh }: Props) {
  const [level, setLevel] = useState(1)
  const [activeLessonId, setActiveLessonId] = useState<string>(LESSONS[0].id)

  const lessons = useMemo(() => lessonsByLevel(level), [level])
  const activeLesson = lessonById(activeLessonId) ?? lessons[0]

  useEffect(() => {
    const first = lessons[0]
    if (first && !lessons.some((l) => l.id === activeLessonId)) setActiveLessonId(first.id)
  }, [lessons, activeLessonId])

  const passedTotal = Object.values(progress.lessons).filter((l) => l.status === 'passed').length

  return (
    <div className="curr-page">
      {/* 级别导航 */}
      <div className="level-bar">
        {LEVELS.map((lv) => {
          const ls = lessonsByLevel(lv.level)
          const done = ls.filter((l) => progress.lessons[l.id]?.status === 'passed').length
          const pct = ls.length ? Math.round((done / ls.length) * 100) : 0
          return (
            <button
              key={lv.level}
              className={`level-tab${level === lv.level ? ' is-active' : ''}`}
              style={{ '--lv-color': lv.color } as React.CSSProperties}
              onClick={() => setLevel(lv.level)}
            >
              <div className="lt-head">
                <span className="lt-num">L{lv.level}</span>
                {pct === 100 && <span className="lt-done">✓</span>}
              </div>
              <div className="lt-name">{lv.name.split('·')[1]?.trim() ?? lv.name}</div>
              <div className="lt-bar">
                <div className="lt-bar-fill" style={{ width: `${pct}%`, background: lv.color }} />
              </div>
            </button>
          )
        })}
      </div>

      <div className="curr-layout">
        {/* 课时列表 */}
        <aside className="lesson-list">
          <div className="ll-header">
            <div className="ll-level" style={{ color: LEVELS[level - 1].color }}>
              {LEVELS[level - 1].name}
            </div>
            <p className="small" style={{ marginTop: 6 }}>
              {LEVELS[level - 1].description}
            </p>
            <div className="pill pill-amber" style={{ marginTop: 'var(--sp-3)' }}>
              适合：{LEVELS[level - 1].targetAudience}
            </div>
          </div>

          <div className="ll-items">
            {lessons.map((l) => {
              const p = progress.lessons[l.id]
              const cat = CATEGORY_META[l.category]
              const active = l.id === activeLesson?.id
              return (
                <button
                  key={l.id}
                  className={`lesson-item${active ? ' is-active' : ''}${p?.status === 'passed' ? ' is-passed' : ''}`}
                  onClick={() => setActiveLessonId(l.id)}
                >
                  <div className="li-icon" style={{ background: `${cat.color}20`, color: cat.color }}>
                    {cat.icon}
                  </div>
                  <div className="li-body">
                    <div className="li-title">{l.title}</div>
                    <div className="li-meta tiny">
                      {cat.label} · {l.estimatedMinutes} 分钟
                      {p && ` · 已练 ${p.attempts} 次`}
                    </div>
                  </div>
                  {p?.status === 'passed' && <span className="li-check">✓</span>}
                  {active && <span className="li-arrow">→</span>}
                </button>
              )
            })}
          </div>

          <div className="ll-footer">
            <div className="tiny">总体进度</div>
            <div className="bar">
              <div className="bar-fill" style={{ width: `${(passedTotal / LESSONS.length) * 100}%` }} />
            </div>
            <div className="tiny" style={{ marginTop: 4 }}>
              {passedTotal} / {LESSONS.length} 课时已通过
            </div>
          </div>
        </aside>

        {/* 课时内容 */}
        <main className="lesson-body">
          {activeLesson && <LessonContent lesson={activeLesson} onAnswer={(ok) => { recordLesson(activeLesson.id, ok); onRefresh() }} />}
        </main>
      </div>
    </div>
  )
}

function LessonContent({ lesson, onAnswer }: { lesson: Lesson; onAnswer: (correct: boolean) => void }) {
  const cat = CATEGORY_META[lesson.category]
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [result, setResult] = useState<Record<number, 'correct' | 'wrong'>>({})

  const submit = (idx: number, answer: string, correct: string) => {
    const ok = answer === correct
    setAnswers((a) => ({ ...a, [idx]: answer }))
    setResult((r) => ({ ...r, [idx]: ok ? 'correct' : 'wrong' }))
    onAnswer(ok)
  }

  return (
    <div className="lesson-content">
      <header className="lc-header">
        <div className="lc-tags">
          <span className="pill" style={{ background: `${cat.color}20`, color: cat.color, borderColor: `${cat.color}40` }}>
            {cat.icon} {cat.label}
          </span>
          <span className="pill">第 {lesson.level} 级</span>
          <span className="pill">约 {lesson.estimatedMinutes} 分钟</span>
        </div>
        <h2 className="title" style={{ marginTop: 'var(--sp-3)' }}>
          {lesson.title}
        </h2>
        <p className="body" style={{ marginTop: 4 }}>
          {lesson.subtitle}
        </p>
        <div className="lc-objective">
          <span className="lo-label">学习目标</span>
          {lesson.objective}
        </div>
      </header>

      <div className="lc-blocks">
        {lesson.blocks.map((block, i) => (
          <BlockRenderer key={i} block={block} index={i} answers={answers} result={result} onSubmit={submit} />
        ))}
      </div>

      <footer className="lc-footer">
        <div className="lcf-icon">🎯</div>
        <div>
          <div className="lcf-label">达标标准</div>
          <div className="lcf-text">{lesson.passCriteria}</div>
        </div>
      </footer>
    </div>
  )
}

function BlockRenderer({
  block,
  index,
  answers,
  result,
  onSubmit,
}: {
  block: LessonBlock
  index: number
  answers: Record<number, string>
  result: Record<number, 'correct' | 'wrong'>
  onSubmit: (idx: number, answer: string, correct: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  void expanded
  void setExpanded

  if (block.kind === 'text') {
    return (
      <section className="block block-text">
        {block.title && <h3 className="block-title">{block.title}</h3>}
        <div className="block-prose">
          {(block.body ?? '').split('\n').map((line, i) => (
            <p key={i} style={line.startsWith('**') || line.trim().startsWith('-') ? { marginTop: 'var(--sp-3)' } : undefined}>
              {renderBold(line)}
            </p>
          ))}
        </div>
      </section>
    )
  }

  if (block.kind === 'tip') {
    return (
      <section className="block block-tip">
        <div className="tip-badge">💡 提示</div>
        <div className="block-prose">
          {block.title && <strong>{block.title}</strong>}
          {(block.body ?? '').split('\n').map((line, i) => (
            <p key={i}>{renderBold(line)}</p>
          ))}
        </div>
      </section>
    )
  }

  if (block.kind === 'key-list' || block.kind === 'scale' || block.kind === 'chord') {
    return (
      <section className={`block block-${block.kind}`}>
        {block.title && <h3 className="block-title">{block.title}</h3>}
        <div className="block-prose">
          {(block.body ?? '').split('\n').map((line, i) => (
            <p key={i}>{renderBold(line)}</p>
          ))}
        </div>
        <MiniKeyboardExplorer kind={block.kind} />
      </section>
    )
  }

  if (block.kind === 'exercise' && block.exercise) {
    const ex = block.exercise
    const chosen = answers[index]
    const state = result[index]
    return (
      <section className={`block block-exercise${state ? ` is-${state}` : ''}`}>
        <div className="ex-head">
          <span className="ex-num">练习 {index + 1}</span>
          {state && <span className="ex-verdict">{state === 'correct' ? '✓ 正确' : '✗ 再想想'}</span>}
        </div>
        <div className="ex-prompt">{ex.prompt}</div>
        <div className="ex-options">
          {(ex.options ?? []).map((opt, i) => (
            <button
              key={i}
              className={`ex-opt${chosen === opt ? ' is-chosen' : ''}${
                state === 'correct' && opt === ex.answer ? ' is-correct' : ''
              }${state === 'wrong' && chosen === opt && opt !== ex.answer ? ' is-wrong' : ''}`}
              onClick={() => !state && onSubmit(index, opt, ex.answer)}
              disabled={!!state}
            >
              <span className="ex-opt-key">{String.fromCharCode(65 + i)}</span>
              {opt}
            </button>
          ))}
        </div>
        {state && (
          <div className={`ex-explain${state === 'correct' ? ' is-correct' : ''}`}>
            <strong>{state === 'correct' ? '答对了！' : '正确答案：' + ex.answer}</strong>
            {ex.explanation}
          </div>
        )}
        {ex.kind === 'note-name' && <NoteNameDrill />}
      </section>
    )
  }

  return null
}

/** 简易 **粗体** 渲染 */
function renderBold(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*)/g)
  return parts.map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? (
      <strong key={i} style={{ color: 'var(--amber-2)', fontWeight: 650 }}>
        {p.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{p}</span>
    ),
  )
}

/** 迷你键盘探索器：展示音阶 / 和弦 / 调号对应的键位 */
function MiniKeyboardExplorer({ kind }: { kind: string }) {
  const [demo, setDemo] = useState<number[] | null>(null)
  const engine = getAudioEngine()

  const demos: Record<string, { label: string; midis: number[] }> = {
    scale: { label: 'C 大调音阶', midis: [60, 62, 64, 65, 67, 69, 71, 72] },
    chord: { label: 'C 大三和弦', midis: [60, 64, 67] },
    'key-list': { label: '中央八度', midis: [60, 61, 62, 63, 64, 65, 66, 67, 68] },
  }
  const d = demos[kind] ?? demos['key-list']

  const play = () => {
    void engine.unlock()
    setDemo(d.midis)
    const t0 = engine.currentTime + 0.05
    d.midis.forEach((m, i) => engine.noteOn(m, { when: t0 + i * 0.16, duration: 0.5, velocity: 0.7 }))
    window.setTimeout(() => setDemo(null), d.midis.length * 160 + 500)
  }

  return (
    <div className="mini-explorer">
      <div className="me-head">
        <span className="small">{d.label}</span>
        <button className="btn btn-sm" onClick={play}>
          ▶ 试听
        </button>
      </div>
      <PianoKeyboard
        lowMidi={48}
        highMidi={72}
        targetMidis={new Set(d.midis)}
        currentMidi={demo ? null : undefined}
        pressedMidis={new Set(demo ?? [])}
        height={82}
        showNoteNames
      />
      <div className="me-legend tiny">
        音名：{d.midis.map((m) => midiToName(m)).join(' · ')}
      </div>
    </div>
  )
}

/** 音名辨识小练习：随机给一个键，学生点击正确的音名 */
function NoteNameDrill() {
  const [target, setTarget] = useState<number>(64)
  const [chosen, setChosen] = useState<number | null>(null)
  const options = useMemo(() => {
    const pool = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]
    return pool.filter((m) => m !== target).slice(0, 4).concat([target]).sort(() => Math.random() - 0.5)
  }, [target])

  const next = () => {
    const pool = [60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 71, 72]
    let m = target
    while (m === target) m = pool[Math.floor(Math.random() * pool.length)]
    setTarget(m)
    setChosen(null)
  }

  return (
    <div className="note-drill">
      <div className="nd-head tiny">音名辨识：点击你听到的音名</div>
      <PianoKeyboard lowMidi={60} highMidi={72} height={68} onNoteOn={(m) => { void getAudioEngine().unlock(); getAudioEngine().demo(m, 0.7); setChosen(m) }} />
      <div className="nd-options">
        {options.map((m) => (
          <button
            key={m}
            className={`nd-opt${chosen === m ? (m === target ? ' is-correct' : ' is-wrong') : ''}`}
            onClick={() => setChosen(m)}
          >
            {midiToName(m)}
          </button>
        ))}
      </div>
      <div className="nd-foot">
        {chosen !== null && (
          <span className={`tiny${chosen === target ? '' : ' nd-hint'}`}>
            {chosen === target ? '✓ 正确！' : `这是 ${midiToName(chosen)}，再听一次`}
          </span>
        )}
        <button className="btn btn-ghost btn-sm" onClick={next}>
          换一题 →
        </button>
      </div>
    </div>
  )
}

export default CurriculumPage
