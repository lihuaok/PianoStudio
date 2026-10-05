/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * App.tsx — 应用外壳与导航
 *
 * 单页应用，六个主视图：
 *   首页 · 课程体系 · 乐理实验室 · 曲目（《致爱丽丝》分章精讲）· 自由练习室 · 学习进度
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { loadProgress, onSyncState, getSyncState, type SyncState, type UserProgress } from '@/core/progress'
import { HomePage } from '@/pages/HomePage'
import { CurriculumPage } from '@/pages/CurriculumPage'
import { TheoryLabPage } from '@/pages/TheoryLabPage'
import { RepertoirePage } from '@/pages/RepertoirePage'
import { AutoPlayPage } from '@/pages/AutoPlayPage'
import { PracticeRoomPage } from '@/pages/PracticeRoomPage'
import { ProgressPage } from '@/pages/ProgressPage'
import { SettingsPage } from '@/pages/SettingsPage'
import { getAudioEngine } from '@/audio/audioEngine'
import { getAutoPlayEngine } from '@/audio/autoPlayEngine'

export type ViewId = 'home' | 'curriculum' | 'theory' | 'repertoire' | 'autoplay' | 'practice' | 'progress' | 'settings'

interface NavEntry {
  id: ViewId
  label: string
  icon: string
  group: string
}

const NAV: NavEntry[] = [
  { id: 'home', label: '首页', icon: 'home', group: '开始' },
  { id: 'curriculum', label: '课程体系', icon: 'book', group: '学习' },
  { id: 'theory', label: '乐理实验室', icon: 'theory', group: '学习' },
  { id: 'repertoire', label: '曲目库', icon: 'music', group: '演奏' },
  { id: 'autoplay', label: '自动演奏', icon: 'autoplay', group: '演奏' },
  { id: 'practice', label: '练习室', icon: 'piano', group: '演奏' },
  { id: 'progress', label: '学习进度', icon: 'chart', group: '我的' },
  { id: 'settings', label: '设置', icon: 'settings', group: '我的' },
]

const VIEW_TITLES: Record<ViewId, { title: string; subtitle: string }> = {
  home: { title: '欢迎回来', subtitle: '今天也来弹一会儿琴吧' },
  curriculum: { title: '课程体系', subtitle: '从零基础到演奏级的完整路径' },
  theory: { title: '乐理实验室', subtitle: '交互式乐理训练与听辨' },
  repertoire: { title: '曲目库', subtitle: '《致爱丽丝》分章精讲与演奏评测' },
  autoplay: { title: '自动演奏', subtitle: '完整演奏《致爱丽丝》全曲（含力度与踏板诠释）' },
  practice: { title: '练习室', subtitle: '自由弹奏、实时评测与录音回放' },
  progress: { title: '学习进度', subtitle: '练习记录、成就与数据分析' },
  settings: { title: '设置', subtitle: '音色、音量、同步与数据' },
}

function Icon({ name, size = 18 }: { name: string; size?: number }) {
  const common = {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 1.8,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className: 'nav-icon',
  }
  switch (name) {
    case 'home':
      return (
        <svg {...common}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
          <path d="M9.5 21v-6h5v6" />
        </svg>
      )
    case 'book':
      return (
        <svg {...common}>
          <path d="M4 4.5A1.5 1.5 0 0 1 5.5 3H19v18H5.5A1.5 1.5 0 0 1 4 19.5z" />
          <path d="M8 3v18" />
          <path d="M11.5 8h4M11.5 12h4" />
        </svg>
      )
    case 'theory':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 3v18M3 12h18" />
          <path d="M12 8.5 15.5 12 12 15.5 8.5 12z" fill="currentColor" stroke="none" opacity=".35" />
        </svg>
      )
    case 'music':
      return (
        <svg {...common}>
          <path d="M9 18V5.5l11-2V16" />
          <circle cx="6.5" cy="18" r="2.5" />
          <circle cx="17.5" cy="16" r="2.5" />
        </svg>
      )
    case 'piano':
      return (
        <svg {...common}>
          <rect x="3" y="5" width="18" height="14" rx="1.5" />
          <path d="M8 5v8M12 5v8M16 5v8" />
          <path d="M6.5 13h2M10.5 13h2M14.5 13h2" />
        </svg>
      )
    case 'autoplay':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="9" />
          <path d="M10 8.6 15.6 12 10 15.4z" fill="currentColor" stroke="none" opacity=".6" />
        </svg>
      )
    case 'chart':
      return (
        <svg {...common}>
          <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...common}>
          <circle cx="12" cy="12" r="3" />
          <path d="M12 2.5v3M12 18.5v3M21.5 12h-3M5.5 12h-3M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1M18.7 18.7l-2.1-2.1M7.4 7.4 5.3 5.3" />
        </svg>
      )
    case 'menu':
      return (
        <svg {...common} className="nav-icon">
          <path d="M4 7h16M4 12h16M4 17h16" />
        </svg>
      )
    default:
      return null
  }
}

export default function App() {
  const [view, setView] = useState<ViewId>(() => {
    const h = window.location.hash.replace('#/', '')
    return (NAV.find((n) => n.id === h)?.id ?? 'home') as ViewId
  })
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [progress, setProgress] = useState<UserProgress>(() => loadProgress())
  const [sync, setSync] = useState<SyncState>(() => getSyncState())

  // 路由同步
  useEffect(() => {
    const onHash = () => {
      const h = window.location.hash.replace('#/', '')
      if (NAV.some((n) => n.id === h)) setView(h as ViewId)
    }
    window.addEventListener('hashchange', onHash)
    return () => window.removeEventListener('hashchange', onHash)
  }, [])

  const navigate = useCallback((next: ViewId) => {
    setView(next)
    window.location.hash = `#/${next}`
    setSidebarOpen(false)
  }, [])

  // 进度刷新
  const refreshProgress = useCallback(() => setProgress(loadProgress()), [])
  useEffect(() => onSyncState(setSync), [])

  // 首次交互解锁音频
  useEffect(() => {
    const unlock = () => void getAudioEngine().unlock()
    window.addEventListener('pointerdown', unlock, { once: true })
    window.addEventListener('keydown', unlock, { once: true })
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  const meta = VIEW_TITLES[view]
  const groups = useMemo(() => {
    const map = new Map<string, NavEntry[]>()
    for (const n of NAV) {
      if (!map.has(n.group)) map.set(n.group, [])
      map.get(n.group)!.push(n)
    }
    return [...map.entries()]
  }, [])

  const totalStars = progress.totalStars

  return (
    <div className="app-shell">
      {sidebarOpen && <div className="scrim" onClick={() => setSidebarOpen(false)} />}

      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="brand">
          <div className="brand-mark">🎹</div>
          <div className="brand-text">
            <div className="brand-title">Piano Studio</div>
            <div className="brand-sub">世界级钢琴教学</div>
          </div>
        </div>

        <nav className="nav">
          {groups.map(([group, items]) => (
            <div key={group}>
              <div className="nav-group-label">{group}</div>
              {items.map((item) => (
                <button
                  key={item.id}
                  className={`nav-item${view === item.id ? ' active' : ''}`}
                  onClick={() => navigate(item.id)}
                >
                  <Icon name={item.icon} />
                  <span>{item.label}</span>
                  {item.id === 'progress' && totalStars > 0 && <span className="nav-badge">⭐ {totalStars}</span>}
                </button>
              ))}
            </div>
          ))}
        </nav>

        <div className="sidebar-footer">
          <div className={`sync-chip status-${sync.status}`} title={sync.message || '本地进度'}>
            <span className="sync-dot" />
            <span className="sync-text">
              {sync.status === 'synced'
                ? '已同步'
                : sync.status === 'syncing'
                  ? '同步中'
                  : sync.status === 'offline'
                    ? '离线'
                    : sync.status === 'error'
                      ? '同步失败'
                      : sync.status === 'unpaired'
                        ? '仅本机'
                        : '本机存储'}
            </span>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <button className="btn btn-ghost btn-icon mobile-only" onClick={() => setSidebarOpen(true)} aria-label="打开菜单">
            <Icon name="menu" />
          </button>
          <div>
            <div className="topbar-title">{meta.title}</div>
          </div>
          <div className="topbar-spacer" />
          <div className="topbar-meta">
            {progress.streakDays > 0 && (
              <span className="pill pill-amber">🔥 连续 {progress.streakDays} 天</span>
            )}
            <span className="pill">累计 {formatDuration(progress.totalPracticeSeconds)}</span>
          </div>
        </header>

        <div className="content-scroll">
          <div className="content-inner">
            {view === 'home' && <HomePage progress={progress} onNavigate={navigate} />}
            {view === 'curriculum' && <CurriculumPage progress={progress} onRefresh={refreshProgress} />}
            {view === 'theory' && <TheoryLabPage progress={progress} onRefresh={refreshProgress} />}
            {view === 'repertoire' && <RepertoirePage progress={progress} onRefresh={refreshProgress} />}
            {view === 'autoplay' && <AutoPlayPage />}
            {view === 'practice' && <PracticeRoomPage progress={progress} onRefresh={refreshProgress} />}
            {view === 'progress' && <ProgressPage progress={progress} onNavigate={navigate} />}
            {view === 'settings' && <SettingsPage progress={progress} onRefresh={refreshProgress} />}
          </div>
        </div>
      </main>
    </div>
  )
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)} 秒`
  const m = Math.floor(seconds / 60)
  const h = Math.floor(m / 60)
  if (h > 0) return `${h} 小时 ${m % 60} 分`
  return `${m} 分钟`
}

/**
 * 调试句柄：把音频引擎挂到 window 上，供自动化音质检测使用
 * （tools/browser-autoplay-check.mjs 用它接 AnalyserNode 实测峰值电平、
 *   频谱重心与基频，避免"音色是否刺耳"只能靠主观判断）。
 * 只读取/调用公开方法，不改变任何播放行为。
 */
if (typeof window !== 'undefined') {
  ;(window as unknown as Record<string, unknown>).__pianoStudio = {
    getAudioEngine,
    getAutoPlayEngine,
  }
}
