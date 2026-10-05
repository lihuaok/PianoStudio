/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * SettingsPage.tsx — 设置
 * 音色与音频 / 个人档案 / 跨设备同步 / 数据管理 / 关于。
 */

import { useEffect, useState } from 'react'
import {
  clearProgress,
  createPairSpace,
  exportProgress,
  getDeviceId,
  getPairCode,
  getSyncState,
  importProgress,
  onSyncState,
  pairWith,
  pullFromServer,
  pushToServer,
  unpair,
  updateProfile,
  type SyncState,
  type UserProgress,
} from '@/core/progress'
import { getAudioEngine, PRESETS } from '@/audio/audioEngine'
import { midiToFrequency } from '@/core/music'
import { furElise } from '@/data/furElise'
import './SettingsPage.css'

interface Props {
  progress: UserProgress
  onRefresh: () => void
}

export function SettingsPage({ progress, onRefresh }: Props) {
  const [sync, setSync] = useState<SyncState>(() => getSyncState())
  const [pairInput, setPairInput] = useState('')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [volume, setVolume] = useState(0.85)
  const [reverb, setReverb] = useState(0.2)
  const [metronomeVol, setMetronomeVol] = useState(0.5)
  const [preset, setPreset] = useState<keyof typeof PRESETS>('grand')

  const engine = getAudioEngine()

  useEffect(() => onSyncState(setSync), [])
  useEffect(() => engine.setMasterVolume(volume), [engine, volume])
  useEffect(() => engine.setReverb(reverb), [engine, reverb])
  useEffect(() => engine.setMetronomeVolume(metronomeVol), [engine, metronomeVol])

  const notify = (text: string, ok = true) => {
    setMsg({ text, ok })
    window.setTimeout(() => setMsg(null), 4000)
  }

  const handleCreate = async () => {
    const r = await createPairSpace()
    if (r.ok && r.code) {
      notify(`同步空间已创建，配对码：${r.code} —— 请在其它设备输入此码`)
    } else notify(r.message, false)
  }

  const handlePair = async () => {
    if (!pairInput.trim()) return
    const r = await pairWith(pairInput)
    notify(r.message, r.ok)
    if (r.ok) setPairInput('')
  }

  const handleExport = () => {
    const json = exportProgress()
    const blob = new Blob([json], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `piano-studio-progress-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    notify('进度已导出为 JSON 文件')
  }

  const handleImport = () => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = 'application/json'
    input.onchange = async () => {
      const file = input.files?.[0]
      if (!file) return
      const text = await file.text()
      const r = importProgress(text)
      notify(r.message, r.ok)
      if (r.ok) onRefresh()
    }
    input.click()
  }

  const handleClear = () => {
    if (!window.confirm('确定要清空全部学习进度吗？此操作不可撤销。')) return
    clearProgress()
    onRefresh()
    notify('学习进度已清空')
  }

  const previewPreset = (p: keyof typeof PRESETS) => {
    setPreset(p)
    void engine.unlock()
    // 弹一个小乐句展示音色
    const seq = [76, 74, 76, 71, 74, 72]
    const t0 = engine.currentTime + 0.06
    seq.forEach((m, i) => engine.noteOn(m, { when: t0 + i * 0.19, duration: 0.45, velocity: 0.78, preset: p }))
  }

  return (
    <div className="set-page">
      {msg && <div className={`set-toast${msg.ok ? ' is-ok' : ' is-err'}`}>{msg.text}</div>}

      {/* 音频 */}
      <section className="card">
        <div className="card-header">
          <h3>🎵 音频设置</h3>
        </div>
        <div className="card-pad set-grid">
          <div className="set-field">
            <label className="tiny">主音量 · {Math.round(volume * 100)}%</label>
            <input type="range" className="range" min={0} max={100} value={volume * 100} onChange={(e) => setVolume(+e.target.value / 100)} />
            <button className="btn btn-sm" onClick={() => { void engine.unlock(); engine.demo(60, 0.8) }}>试听</button>
          </div>

          <div className="set-field">
            <label className="tiny">混响量 · {Math.round(reverb * 100)}%</label>
            <input type="range" className="range" min={0} max={100} value={reverb * 100} onChange={(e) => setReverb(+e.target.value / 100)} />
          </div>

          <div className="set-field">
            <label className="tiny">节拍器音量 · {Math.round(metronomeVol * 100)}%</label>
            <input type="range" className="range" min={0} max={100} value={metronomeVol * 100} onChange={(e) => setMetronomeVol(+e.target.value / 100)} />
            <button className="btn btn-sm" onClick={() => engine.click(engine.currentTime + 0.05, true)}>试听</button>
          </div>

          <div className="set-field set-field-wide">
            <label className="tiny">音色（点击试听）</label>
            <div className="preset-grid">
              {Object.entries(PRESETS).map(([k, v]) => (
                <button
                  key={k}
                  className={`preset-card${preset === k ? ' is-active' : ''}`}
                  onClick={() => previewPreset(k as keyof typeof PRESETS)}
                >
                  <span className="pc-name">{v.label}</span>
                  <span className="pc-desc tiny">
                    {k === 'grand' && '均衡、适合所有曲目'}
                    {k === 'bright' && '泛音丰富、明亮现代'}
                    {k === 'soft' && '余音短、接近弱音踏板'}
                    {k === 'music' && '音乐会风格的平衡'}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div className="set-field set-field-wide">
            <label className="tiny">标准音高</label>
            <div className="a4-row">
              <span className="tiny">A4 = 440 Hz（标准）· 实际 {midiToFrequency(69).toFixed(2)} Hz</span>
              <button className="btn btn-sm" onClick={() => engine.demo(69, 0.85)}>播放 A4</button>
            </div>
          </div>
        </div>
      </section>

      {/* 个人档案 */}
      <section className="card">
        <div className="card-header">
          <h3>👤 个人档案</h3>
        </div>
        <div className="card-pad set-grid">
          <div className="set-field">
            <label className="tiny">昵称</label>
            <input
              className="input"
              value={progress.profile.displayName}
              onChange={(e) => { updateProfile({ displayName: e.target.value }); onRefresh() }}
            />
          </div>
          <div className="set-field">
            <label className="tiny">每日目标 · {progress.profile.dailyGoalMinutes} 分钟</label>
            <input
              type="range"
              className="range"
              min={5}
              max={180}
              step={5}
              value={progress.profile.dailyGoalMinutes}
              onChange={(e) => { updateProfile({ dailyGoalMinutes: +e.target.value }); onRefresh() }}
            />
          </div>
          <div className="set-field">
            <label className="tiny">设备标识</label>
            <div className="device-id mono">{getDeviceId()}</div>
          </div>
        </div>
      </section>

      {/* 同步 */}
      <section className="card">
        <div className="card-header">
          <h3>☁️ 跨设备同步</h3>
          <div className="spacer" />
          <span className={`pill pill-${sync.paired ? 'success' : 'danger'}`}>
            {sync.paired ? '已配对' : '未配对'}
          </span>
        </div>
        <div className="card-pad set-grid">
          <div className="sync-status">
            <div className="ss-row">
              <span className="tiny">状态</span>
              <span className={`ss-value status-${sync.status}`}>{sync.message || '等待操作'}</span>
            </div>
            <div className="ss-row">
              <span className="tiny">配对码</span>
              <span className="mono ss-code">{getPairCode() ?? '—'}</span>
            </div>
            <div className="ss-row">
              <span className="tiny">上次同步</span>
              <span className="ss-value">{sync.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleString('zh-CN') : '从未'}</span>
            </div>
          </div>

          <div className="set-field">
            <label className="tiny">在其它设备上输入配对码以关联</label>
            <div className="pair-row">
              <input
                className="input mono"
                placeholder="ABCD-2345"
                value={pairInput}
                onChange={(e) => setPairInput(e.target.value.toUpperCase())}
                maxLength={9}
              />
              <button className="btn btn-primary" onClick={handlePair} disabled={!pairInput.trim()}>
                配对
              </button>
            </div>
          </div>

          <div className="set-field">
            <label className="tiny">同步操作</label>
            <div className="btn-row">
              <button className="btn" onClick={() => createPairSpace().then((r) => notify(r.ok ? `已创建，配对码 ${r.code}` : r.message, r.ok))}>
                创建同步空间
              </button>
              <button className="btn" onClick={() => void pushToServer().then((ok) => notify(ok ? '已推送到云端' : '推送失败'))}>
                ⬆ 立即上传
              </button>
              <button className="btn" onClick={() => void pullFromServer().then((ok) => notify(ok ? '已从云端拉取' : '拉取失败', ok))}>
                ⬇ 立即下载
              </button>
              <button className="btn btn-ghost" onClick={() => { unpair(); notify('已解除配对（数据仍保留在本机）') }}>
                解除配对
              </button>
            </div>
          </div>

          <div className="set-note">
            <strong>工作方式：</strong>所有进度先写入本机（离线可用），再后台同步到服务端。
            多设备同时练习时，服务端按「最高分取最大、练习记录取并集」的策略合并，不会互相覆盖。
            首次使用请点击「创建同步空间」获取配对码，然后在手机/平板上输入同一码即可。
          </div>
        </div>
      </section>

      {/* 数据 */}
      <section className="card">
        <div className="card-header">
          <h3>💾 数据管理</h3>
        </div>
        <div className="card-pad">
          <div className="btn-row">
            <button className="btn" onClick={handleExport}>⬇ 导出进度</button>
            <button className="btn" onClick={handleImport}>⬆ 导入进度</button>
            <div className="spacer" />
            <button className="btn btn-danger" onClick={handleClear}>清空全部数据</button>
          </div>
          <div className="set-note">
            导出的 JSON 文件包含课程进度、章节成绩、练习记录与个人设置，可在任意设备导入以恢复数据。
          </div>
        </div>
      </section>

      {/* 关于 */}
      <section className="card">
        <div className="card-header">
          <h3>ℹ️ 关于 Piano Studio</h3>
        </div>
        <div className="card-pad about-body">
          <div className="about-grid">
            <div>
              <div className="about-label">乐谱来源</div>
              <p>
                《致爱丽丝》乐谱数据由本项目的 LilyPond 解析器从
                <strong> Mutopia Project</strong>（Mutopia-2015/08/18-931）的权威雕版源生成，
                底本为 <strong>Breitkopf & Härtel 1888</strong> 版本，公有领域。
              </p>
              <p className="about-note">
                全曲 {furElise.totalMeasures} 小节、{furElise.notes.length} 个音符，
                含反复记号、倚音、力度与 8va 记号，全部按谱面精确还原。
              </p>
            </div>
            <div>
              <div className="about-label">技术实现</div>
              <ul className="about-list">
                <li>钢琴音色：Web Audio 实时合成（8 分音泛音列 + 槌击噪声 + 程序生成混响），零采样依赖</li>
                <li>节拍器：25ms 前瞻调度，时序精度不受主线程卡顿影响</li>
                <li>评测引擎：动态规划音高对齐 + 多维加权评分</li>
                <li>麦克风输入：YIN 基频检测算法，支持实时音准（音分）反馈</li>
                <li>进度同步：离线优先 + 服务端合并策略，原子写入保证数据安全</li>
              </ul>
            </div>
          </div>
        </div>
      </section>
    </div>
  )
}

export default SettingsPage
