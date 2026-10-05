/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * ProgressPage.tsx — 学习进度
 * 统计卡片 + 折线图 + 章节掌握度 + 练习记录 + 成就。
 */

import { useMemo } from 'react'
import { practiceHeatmap, todayPracticeSeconds, type UserProgress } from '@/core/progress'
import { LEVELS, LESSONS, lessonsByLevel, CATEGORY_META } from '@/data/curriculum'
import { sections } from '@/data/furElise'
import { scoreGrade } from '@/core/evaluator'
import type { ViewId } from '@/App'
import { formatDuration } from '@/App'
import './ProgressPage.css'

interface Props {
  progress: UserProgress
  onNavigate: (v: ViewId) => void
}

export function ProgressPage({ progress, onNavigate }: Props) {
  const heat = useMemo(() => practiceHeatmap(progress, 91), [progress])

  // 最近 30 天折线
  const trend = useMemo(() => heat.slice(-30), [heat])
  const maxTrend = Math.max(60, ...trend.map((t) => t.seconds))

  // 分类练习统计
  const byCategory = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of progress.sessions) {
      const cat = s.targetId.startsWith('sec_') || s.targetId === 'practice_room' ? 'practice' : s.targetId
      map.set(cat, (map.get(cat) ?? 0) + s.durationSeconds)
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1])
  }, [progress.sessions])

  const recentSessions = progress.sessions.slice(0, 20)
  const passedCount = Object.values(progress.lessons).filter((l) => l.status === 'passed').length
  const mastered = sections.filter((s) => progress.sections[s.id]?.mastered)
  const avgScore = useMemo(() => {
    const scored = progress.sessions.filter((s) => s.score !== null)
    if (!scored.length) return 0
    return Math.round(scored.reduce((a, s) => a + (s.score ?? 0), 0) / scored.length)
  }, [progress.sessions])

  const achievements = useMemo(() => buildAchievements(progress), [progress])

  // 折线路径
  const linePath = useMemo(() => {
    if (trend.length < 2) return ''
    const w = 100
    const h = 40
    const pts = trend.map((t, i) => {
      const x = (i / (trend.length - 1)) * w
      const y = h - (t.seconds / maxTrend) * h
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    return `M ${pts.join(' L ')}`
  }, [trend, maxTrend])

  const areaPath = linePath ? `${linePath} L 100,40 L 0,40 Z` : ''

  return (
    <div className="prog-page">
      {/* 统计卡 */}
      <div className="pg-stats stagger">
        <BigStat icon="⏱️" label="累计练习" value={formatDuration(progress.totalPracticeSeconds)} sub={`今日 ${formatDuration(todayPracticeSeconds(progress))}`} color="var(--indigo-2)" />
        <BigStat icon="🔥" label="连续学习" value={`${progress.streakDays} 天`} sub={progress.streakDays >= 7 ? '坚持得很好！' : '保持节奏'} color="var(--amber-3)" />
        <BigStat icon="📚" label="课程通过" value={`${passedCount}/${LESSONS.length}`} sub={`${Math.round((passedCount / LESSONS.length) * 100)}% 完成度`} color="#e879f9" />
        <BigStat icon="🎼" label="章节掌握" value={`${mastered.length}/${sections.length}`} sub="达到 85 分算掌握" color="var(--success)" />
        <BigStat icon="⭐" label="累计星数" value={`${progress.totalStars}`} sub="每提升一档 +1" color="#f87171" />
        <BigStat icon="📊" label="平均得分" value={avgScore ? `${avgScore}` : '—'} sub={`${progress.sessions.length} 次评分记录`} color="var(--info)" />
      </div>

      <div className="pg-row">
        {/* 趋势图 */}
        <section className="card trend-card">
          <div className="card-header">
            <h3>练习趋势</h3>
            <div className="spacer" />
            <span className="tiny">最近 30 天</span>
          </div>
          <div className="card-pad">
            <div className="trend-chart">
              <svg viewBox="0 0 100 40" preserveAspectRatio="none" className="trend-svg">
                <defs>
                  <linearGradient id="trendGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="rgba(240,199,102,.42)" />
                    <stop offset="100%" stopColor="rgba(240,199,102,0)" />
                  </linearGradient>
                </defs>
                {[10, 20, 30].map((y) => (
                  <line key={y} x1="0" y1={y} x2="100" y2={y} className="trend-grid" />
                ))}
                {areaPath && <path d={areaPath} fill="url(#trendGrad)" />}
                {linePath && <path d={linePath} className="trend-line" />}
              </svg>
              <div className="trend-labels tiny">
                <span>{trend[0]?.date.slice(5)}</span>
                <span>{trend[Math.floor(trend.length / 2)]?.date.slice(5)}</span>
                <span>今天</span>
              </div>
            </div>

            <div className="trend-legend">
              <span className="tiny">峰值 {formatDuration(maxTrend)} / 天</span>
              <div className="spacer" />
              <span className="tiny">30 天共 {formatDuration(trend.reduce((a, t) => a + t.seconds, 0))}</span>
            </div>
          </div>
        </section>

        {/* 热力图 */}
        <section className="card">
          <div className="card-header">
            <h3>练习日历</h3>
            <div className="spacer" />
            <span className="tiny">13 周</span>
          </div>
          <div className="card-pad">
            <div className="heatmap heatmap-lg">
              {heat.map((h, i) => {
                const intensity = h.seconds / Math.max(60, ...heat.map((x) => x.seconds))
                return (
                  <div
                    key={i}
                    className="heat-cell"
                    style={{
                      width: 15,
                      height: 15,
                      background:
                        h.seconds === 0
                          ? 'rgba(255,255,255,.045)'
                          : `rgba(240,199,102,${0.14 + intensity * 0.8})`,
                    }}
                    title={`${h.date}：${formatDuration(h.seconds)}`}
                  />
                )
              })}
            </div>
          </div>
        </section>
      </div>

      {/* 成就 */}
      <section className="card">
        <div className="card-header">
          <h3>成就</h3>
        </div>
        <div className="card-pad">
          <div className="ach-grid">
            {achievements.map((a) => (
              <div key={a.id} className={`ach${a.unlocked ? ' is-unlocked' : ''}`}>
                <div className="ach-icon">{a.unlocked ? a.icon : '🔒'}</div>
                <div className="ach-name">{a.name}</div>
                <div className="ach-desc tiny">{a.desc}</div>
                {a.progress !== null && (
                  <div className="ach-progress">
                    <div className="bar">
                      <div className="bar-fill" style={{ width: `${Math.min(100, a.progress * 100)}%` }} />
                    </div>
                    <span className="tiny mono">{a.progressText}</span>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 章节掌握 */}
      <section className="card">
        <div className="card-header">
          <h3>曲目章节掌握度</h3>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('repertoire')}>
            去练习 →
          </button>
        </div>
        <div className="card-pad">
          <div className="sec-table">
            {sections.map((s) => {
              const p = progress.sections[s.id]
              const pct = p ? Math.min(100, p.bestScore) : 0
              const color = pct >= 85 ? 'var(--success)' : pct >= 60 ? 'var(--amber-3)' : pct > 0 ? 'var(--warning)' : 'var(--text-4)'
              return (
                <div key={s.id} className="sec-row">
                  <span className="sr-form">{s.form}</span>
                  <span className="sr-name truncate">{s.name.replace(/^第 \d+ 章 · /, '')}</span>
                  <span className="sr-range tiny mono">m{s.startMeasure}–{s.endMeasure}</span>
                  <div className="sr-bar">
                    <div className="bar">
                      <div className="bar-fill" style={{ width: `${pct}%`, background: color }} />
                    </div>
                  </div>
                  <span className="sr-score mono" style={{ color }}>
                    {p?.bestScore ?? '—'}
                  </span>
                  <span className="sr-attempts tiny mono">{p?.attempts ?? 0} 次</span>
                </div>
              )
            })}
          </div>
        </div>
      </section>

      {/* 课程进度 */}
      <section className="card">
        <div className="card-header">
          <h3>课程进度</h3>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('curriculum')}>
            去学习 →
          </button>
        </div>
        <div className="card-pad">
          {LEVELS.map((lv) => {
            const ls = lessonsByLevel(lv.level)
            return (
              <div key={lv.level} className="lvl-row">
                <span className="lvl-tag mono" style={{ background: `${lv.color}22`, color: lv.color }}>
                  L{lv.level}
                </span>
                <span className="lvl-name">{lv.name}</span>
                <div className="lvl-lessons">
                  {ls.map((l) => {
                    const p = progress.lessons[l.id]
                    const cat = CATEGORY_META[l.category]
                    return (
                      <span
                        key={l.id}
                        className={`lvl-pill${p?.status === 'passed' ? ' is-passed' : p ? ' is-started' : ''}`}
                        title={l.title}
                        style={{ borderColor: p?.status === 'passed' ? cat.color : undefined }}
                      >
                        {cat.icon} {l.title.slice(0, 6)}
                      </span>
                    )
                  })}
                </div>
              </div>
            )
          })}
        </div>
      </section>

      {/* 练习记录 */}
      <section className="card">
        <div className="card-header">
          <h3>最近练习记录</h3>
          <div className="spacer" />
          <span className="tiny">共 {progress.sessions.length} 条</span>
        </div>
        {recentSessions.length === 0 ? (
          <div className="card-pad text-center">
            <p className="small">还没有练习记录。去弹一首《致爱丽丝》吧！</p>
            <button className="btn btn-primary" style={{ marginTop: 'var(--sp-3)' }} onClick={() => onNavigate('repertoire')}>
              开始练习
            </button>
          </div>
        ) : (
          <div className="session-list">
            {recentSessions.map((s) => {
              const g = s.score !== null ? scoreGrade(s.score) : null
              const d = new Date(s.startedAt)
              return (
                <div key={s.id} className="session-row">
                  <div className="sr2-date tiny">
                    {d.getMonth() + 1}/{d.getDate()}
                    <div className="sr2-time">{String(d.getHours()).padStart(2, '0')}:{String(d.getMinutes()).padStart(2, '0')}</div>
                  </div>
                  <div className="sr2-name truncate">{s.targetName}</div>
                  <span className="tiny sr2-hand">{s.hand === 'right' ? '右手' : s.hand === 'left' ? '左手' : '双手'}</span>
                  {s.bpm > 0 && <span className="tiny sr2-bpm mono">{s.bpm} BPM</span>}
                  <span className="tiny sr2-dur">{formatDuration(s.durationSeconds)}</span>
                  {g && (
                    <span className="sr2-score mono" style={{ color: g.color }}>
                      {s.score}
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>
    </div>
  )
}

function BigStat({ icon, label, value, sub, color }: { icon: string; label: string; value: string; sub: string; color: string }) {
  return (
    <div className="big-stat card">
      <div className="bs-icon" style={{ background: `${color}1e`, color }}>
        {icon}
      </div>
      <div className="bs-value" style={{ color }}>
        {value}
      </div>
      <div className="bs-label">{label}</div>
      <div className="bs-sub tiny">{sub}</div>
    </div>
  )
}

interface Achievement {
  id: string
  icon: string
  name: string
  desc: string
  unlocked: boolean
  progress: number | null
  progressText?: string
}

function buildAchievements(p: UserProgress): Achievement[] {
  const hours = p.totalPracticeSeconds / 3600
  const sessionCount = p.sessions.length
  const perfectRuns = p.sessions.filter((s) => (s.score ?? 0) >= 95).length
  const masteredCount = Object.values(p.sections).filter((s) => s.mastered).length
  const passedLessons = Object.values(p.lessons).filter((l) => l.status === 'passed').length

  return [
    { id: 'first', icon: '🌱', name: '第一步', desc: '完成第一次练习', unlocked: sessionCount >= 1, progress: Math.min(1, sessionCount / 1), progressText: `${sessionCount}/1` },
    { id: 'streak3', icon: '🔥', name: '三日不断', desc: '连续学习 3 天', unlocked: p.streakDays >= 3, progress: Math.min(1, p.streakDays / 3), progressText: `${p.streakDays}/3` },
    { id: 'streak7', icon: '⚡', name: '一周坚持', desc: '连续学习 7 天', unlocked: p.streakDays >= 7, progress: Math.min(1, p.streakDays / 7), progressText: `${p.streakDays}/7` },
    { id: 'hour1', icon: '⏳', name: '一小时', desc: '累计练习满 1 小时', unlocked: hours >= 1, progress: Math.min(1, hours), progressText: `${hours.toFixed(1)}/1h` },
    { id: 'hour10', icon: '🏔️', name: '十小时', desc: '累计练习满 10 小时', unlocked: hours >= 10, progress: Math.min(1, hours / 10), progressText: `${hours.toFixed(1)}/10h` },
    { id: 'sessions50', icon: '📿', name: '五十次', desc: '完成 50 次练习', unlocked: sessionCount >= 50, progress: Math.min(1, sessionCount / 50), progressText: `${sessionCount}/50` },
    { id: 'perfect', icon: '💎', name: '接近完美', desc: '取得一次 95 分以上', unlocked: perfectRuns >= 1, progress: Math.min(1, perfectRuns), progressText: `${perfectRuns}/1` },
    { id: 'chapter5', icon: '🎖️', name: '五个章节', desc: '掌握 5 个曲目章节', unlocked: masteredCount >= 5, progress: Math.min(1, masteredCount / 5), progressText: `${masteredCount}/5` },
    { id: 'lesson10', icon: '🎓', name: '十节课', desc: '通过 10 个课时', unlocked: passedLessons >= 10, progress: Math.min(1, passedLessons / 10), progressText: `${passedLessons}/10` },
  ]
}

export default ProgressPage
