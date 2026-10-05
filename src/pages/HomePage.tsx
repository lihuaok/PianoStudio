/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * HomePage.tsx — 首页
 * 今日概览、快速入口、继续学习、曲目推荐。
 */

import { useMemo } from 'react'
import type { UserProgress } from '@/core/progress'
import { todayPracticeSeconds, practiceHeatmap } from '@/core/progress'
import { LEVELS, LESSONS, lessonsByLevel } from '@/data/curriculum'
import { sections, furElise } from '@/data/furElise'
import type { ViewId } from '@/App'
import { formatDuration } from '@/App'
import './HomePage.css'

interface Props {
  progress: UserProgress
  onNavigate: (v: ViewId) => void
}

export function HomePage({ progress, onNavigate }: Props) {
  const todaySeconds = todayPracticeSeconds(progress)
  const goalSeconds = progress.profile.dailyGoalMinutes * 60
  const goalPct = Math.min(100, Math.round((todaySeconds / goalSeconds) * 100))

  const heat = useMemo(() => practiceHeatmap(progress, 91), [progress])

  const passedCount = Object.values(progress.lessons).filter((l) => l.status === 'passed').length
  const masteredSections = Object.values(progress.sections).filter((s) => s.mastered).length
  const nextLesson = useMemo(() => {
    for (const level of LEVELS) {
      const lessons = lessonsByLevel(level.level)
      const pending = lessons.find((l) => progress.lessons[l.id]?.status !== 'passed')
      if (pending) return pending
    }
    return LESSONS[0]
  }, [progress])

  const continueSection = useMemo(() => {
    const withProgress = sections
      .map((s) => ({ s, p: progress.sections[s.id] }))
      .filter((x) => x.p)
      .sort((a, b) => b.p.lastPlayedAt - a.p.lastPlayedAt)
    return withProgress[0]?.s ?? sections[0]
  }, [progress])

  const heatMax = Math.max(60, ...heat.map((h) => h.seconds))

  return (
    <div className="home-page">
      {/* 英雄区 */}
      <section className="hero">
        <div className="hero-content">
          <div className="hero-eyebrow">
            <span className="pill pill-amber">内置核心曲目</span>
            <span className="pill">贝多芬 · WoO 59</span>
          </div>
          <h1 className="display">
            从 <em>第一个音</em> 到 <em>完整演奏</em>
          </h1>
          <p className="hero-sub">
            六级课程体系 · 互动乐理实验室 · 实时弹奏评测 · 《致爱丽丝》分章精讲
            <br />
            乐谱底本取自 Mutopia Project（Breitkopf & Härtel 1888），逐音精确。
          </p>
          <div className="hero-actions">
            <button className="btn btn-primary btn-lg" onClick={() => onNavigate('repertoire')}>
              🎼 开始学《致爱丽丝》
            </button>
            <button className="btn btn-lg" onClick={() => onNavigate('curriculum')}>
              📚 浏览课程体系
            </button>
            <button className="btn btn-lg" onClick={() => onNavigate('autoplay')}>
              ▶ 完整演奏全曲
            </button>
          </div>
        </div>

        {/* 今日卡片 */}
        <div className="hero-panel">
          <div className="today-ring">
            <svg viewBox="0 0 120 120" className="ring-svg">
              <circle cx="60" cy="60" r="52" className="ring-track" />
              <circle
                cx="60"
                cy="60"
                r="52"
                className="ring-fill"
                strokeDasharray={`${(goalPct / 100) * 326.7} 326.7`}
              />
            </svg>
            <div className="ring-center">
              <div className="ring-value">{goalPct}%</div>
              <div className="ring-label">今日目标</div>
            </div>
          </div>
          <div className="today-stats">
            <div className="today-stat">
              <span className="ts-value">{formatDuration(todaySeconds)}</span>
              <span className="ts-label">今日练习</span>
            </div>
            <div className="today-stat">
              <span className="ts-value">{progress.streakDays}</span>
              <span className="ts-label">连续天数</span>
            </div>
            <div className="today-stat">
              <span className="ts-value">⭐ {progress.totalStars}</span>
              <span className="ts-label">累计星数</span>
            </div>
          </div>
        </div>
      </section>

      {/* 快捷统计 */}
      <section className="stat-grid stagger">
        <StatCard
          icon="📚"
          label="课程进度"
          value={`${passedCount} / ${LESSONS.length}`}
          sub="已通过课时"
          onClick={() => onNavigate('curriculum')}
          color="var(--indigo-3)"
        />
        <StatCard
          icon="🎼"
          label="曲目掌握"
          value={`${masteredSections} / ${sections.length}`}
          sub="章节达到 85 分"
          onClick={() => onNavigate('repertoire')}
          color="var(--amber-3)"
        />
        <StatCard
          icon="⏱️"
          label="累计练习"
          value={formatDuration(progress.totalPracticeSeconds)}
          sub={`共 ${progress.sessions.length} 次记录`}
          onClick={() => onNavigate('progress')}
          color="var(--success)"
        />
        <StatCard
          icon="🎵"
          label="练习曲目"
          value={furElise.title}
          sub={`${furElise.totalMeasures} 小节 · ${furElise.key}`}
          onClick={() => onNavigate('autoplay')}
          color="#e879f9"
        />
      </section>

      <div className="home-grid">
        {/* 继续学习 */}
        <section className="card continue-card">
          <div className="card-header">
            <h3>继续学习</h3>
            <div className="spacer" />
            <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('curriculum')}>
              全部课程 →
            </button>
          </div>
          <div className="continue-body">
            <div className="continue-item" onClick={() => onNavigate('curriculum')}>
              <div className="ci-icon" style={{ background: 'rgba(111,146,214,.16)', color: 'var(--indigo-2)' }}>
                📖
              </div>
              <div className="ci-body">
                <div className="ci-title">{nextLesson.title}</div>
                <div className="ci-sub">
                  第 {nextLesson.level} 级 · {nextLesson.subtitle} · 约 {nextLesson.estimatedMinutes} 分钟
                </div>
              </div>
              <div className="ci-arrow">→</div>
            </div>

            <div className="continue-item" onClick={() => onNavigate('repertoire')}>
              <div className="ci-icon" style={{ background: 'rgba(240,199,102,.16)', color: 'var(--amber-2)' }}>
                🎼
              </div>
              <div className="ci-body">
                <div className="ci-title">{continueSection.name}</div>
                <div className="ci-sub">
                  小节 {continueSection.startMeasure}–{continueSection.endMeasure} ·{' '}
                  {progress.sections[continueSection.id]
                    ? `最好成绩 ${progress.sections[continueSection.id].bestScore}`
                    : '尚未开始'}
                </div>
              </div>
              <div className="ci-arrow">→</div>
            </div>
          </div>
        </section>

        {/* 练习热力图 */}
        <section className="card heat-card">
          <div className="card-header">
            <h3>练习热力图</h3>
            <div className="spacer" />
            <span className="tiny">最近 13 周</span>
          </div>
          <div className="card-pad">
            <div className="heatmap">
              {heat.map((h, i) => {
                const intensity = h.seconds / heatMax
                return (
                  <div
                    key={i}
                    className="heat-cell"
                    style={{
                      background:
                        h.seconds === 0
                          ? 'rgba(255,255,255,.045)'
                          : `rgba(240,199,102,${0.16 + intensity * 0.78})`,
                    }}
                    title={`${h.date}：${formatDuration(h.seconds)}`}
                  />
                )
              })}
            </div>
            <div className="heat-legend">
              <span className="tiny">少</span>
              <div className="heat-scale">
                {[0.06, 0.25, 0.45, 0.68, 0.94].map((o) => (
                  <div key={o} className="heat-cell" style={{ background: `rgba(240,199,102,${o})` }} />
                ))}
              </div>
              <span className="tiny">多</span>
            </div>
          </div>
        </section>
      </div>

      {/* 学习路径 */}
      <section className="path-section">
        <div className="row-between" style={{ marginBottom: 'var(--sp-4)' }}>
          <div>
            <h2 className="title">六级学习路径</h2>
            <p className="small">按顺序推进，也可以按需跳级</p>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => onNavigate('curriculum')}>
            查看完整课程 →
          </button>
        </div>
        <div className="path-grid stagger">
          {LEVELS.map((lv) => {
            const lessons = lessonsByLevel(lv.level)
            const done = lessons.filter((l) => progress.lessons[l.id]?.status === 'passed').length
            const started = lessons.some((l) => progress.lessons[l.id])
            const pct = lessons.length ? Math.round((done / lessons.length) * 100) : 0
            return (
              <button
                key={lv.level}
                className={`path-card card card-hover${started ? ' is-started' : ''}`}
                style={{ '--lv-color': lv.color } as React.CSSProperties}
                onClick={() => onNavigate('curriculum')}
              >
                <div className="pc-level">L{lv.level}</div>
                <div className="pc-name">{lv.name}</div>
                <div className="pc-audience tiny">{lv.targetAudience}</div>
                <div className="pc-desc small clamp-3">{lv.description}</div>
                <div className="pc-progress">
                  <div className="bar">
                    <div className="bar-fill" style={{ width: `${pct}%`, background: lv.color }} />
                  </div>
                  <span className="tiny mono">
                    {done}/{lessons.length}
                  </span>
                </div>
              </button>
            )
          })}
        </div>
      </section>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  sub,
  onClick,
  color,
}: {
  icon: string
  label: string
  value: string
  sub: string
  onClick: () => void
  color: string
}) {
  return (
    <button className="stat-card card card-hover" onClick={onClick}>
      <div className="sc-icon" style={{ background: `${color}22`, color }}>
        {icon}
      </div>
      <div className="sc-body">
        <div className="sc-label tiny">{label}</div>
        <div className="sc-value" style={{ color }}>
          {value}
        </div>
        <div className="sc-sub tiny">{sub}</div>
      </div>
    </button>
  )
}

export default HomePage
