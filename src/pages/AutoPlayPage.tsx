/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * AutoPlayPage.tsx — 钢琴自动演奏
 *
 * 完整演奏贝多芬《致爱丽丝》WoO 59 全曲（105 小节 · ABACA 回旋曲式 · 约 3 分钟），
 * 而不是只弹那 8 个音的开头动机。
 *
 * 与既有功能的关系：**完全新增**，不改动任何现有页面/引擎的行为。
 *  · 数据：沿用 src/data/furElise.json（Mutopia/LilyPond 权威源，930 音 / 1041 发声）
 *  · 发声：真实钢琴采样优先（src/audio/sampleEngine.ts，Salamander Grand Piano V3 三层力度），
 *          未就绪时回退内置合成引擎（src/audio/audioEngine.ts）
 *  · 诠释：新增 src/core/interpretation.ts（力度 / 踏板 / 乐句 / 弹性速度）
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { furElise, sections as PIECE_SECTIONS } from '@/data/furElise'
import { useAutoPlayer } from '@/hooks/useAutoPlayer'
import { PianoKeyboard } from '@/components/PianoKeyboard'
import { getAudioEngine, PRESETS, type PianoPreset } from '@/audio/audioEngine'
import { beatsToSeconds } from '@/core/interpretation'
import './AutoPlayPage.css'

const fmt = (s: number) => {
  if (!isFinite(s) || s < 0) s = 0
  const m = Math.floor(s / 60)
  const sec = Math.floor(s % 60)
  return `${m}:${String(sec).padStart(2, '0')}`
}

export function AutoPlayPage() {
  const player = useAutoPlayer(furElise)
  const { score, snap } = player

  const [volume, setVolume] = useState(0.85)
  // 126 八分/分 ≈ ♩=63：Mutopia 底本标 ♩=72 偏慢，这里取克莱德曼录音的常速，
  // 全曲约 3 分钟（比之前的 108 快 17%）。
  const [bpm, setBpm] = useState(126)
  const [reverb, setReverb] = useState(0.32)
  const [pedalOn, setPedalOn] = useState(true)
  const [resonanceOn, setResonanceOn] = useState(false)
  const [sampleLoading, setSampleLoading] = useState(false)
  const [sampleMsg, setSampleMsg] = useState('')
  const [timbre, setTimbre] = useState<PianoPreset>('warm')

  const srcState = player.sampleState
  const srcPct = Math.round(player.sampleProgress * 100)

  // 键盘联动：正在发声的音高
  const active = useMemo(() => new Set(snap.activeNotes), [snap.activeNotes])

  // 键盘音域：跟曲目实际音域（含上下余量）
  const [lowMidi, highMidi] = useMemo(() => {
    const ms = score.notes.flatMap((n) => n.midis)
    const lo = Math.max(21, Math.min(...ms) - 2)
    const hi = Math.min(108, Math.max(...ms) + 2)
    return [lo, hi] as const
  }, [score])

  const onSeek = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      player.seekProgress(Number(e.target.value) / 1000)
    },
    [player],
  )

  // 引擎是单例：离开本页再回来时把 UI 初值重新推给引擎，避免"滑块显示 A、实际是 B"
  useEffect(() => {
    player.setTimbre(timbre)
    player.setVolume(volume)
    player.setReverb(reverb)
    player.setBpm(bpm)
    player.setPedalEnabled(pedalOn)
    player.setResonance(resonanceOn)
    // 仅在挂载时同步一次
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const toggleSamples = async () => {
    if (player.sampleEnabled) {
      player.disableSamples()
      setSampleMsg('已切回合成音源')
      return
    }
    setSampleLoading(true)
    setSampleMsg('正在读取采样清单…')
    const ok = await player.enableSamples()
    setSampleLoading(false)
    setSampleMsg(ok ? '高保真采样音源已启用（未下载的音会自动回退合成）' : '未找到采样资源（public/samples/manifest.json），继续使用合成音源')
  }

  const jumpTo = (measure: number) => {
    // 弱起小节（m0）在"第 0 拍"之前，跳转点不能小于曲首拍
    player.seekBeat(Math.max(score.startBeat, (measure - 1) * score.beatsPerMeasure))
  }

  const totalSeconds = beatsToSeconds(score.spanBeats, bpm)
  const quarterBpm = Math.round(bpm / 2) // 3/8 拍：显示成音乐人习惯的 ♩=

  return (
    <div className="ap-page">
      {/* ── 曲目横幅 ───────────────────────────────────────────── */}
      <section className="card card-pad ap-banner">
        <div className="ap-banner-left">
          <div className="ap-eyebrow">自动演奏 · Auto Play</div>
          <h2 className="ap-title">{furElise.title}</h2>
          <div className="ap-sub">
            {furElise.titleOriginal} · {furElise.catalog} · {furElise.composer}
          </div>
          <div className="ap-meta">
            <span className="pill pill-indigo">{furElise.key}</span>
            <span className="pill">{furElise.tempoMark}</span>
            <span className="pill">ABACA 回旋曲式</span>
            <span className="pill">{score.notes.length} 音 · {score.measureCount - 1} 小节</span>
            <span className="pill pill-amber">约 {fmt(totalSeconds)}</span>
          </div>
        </div>
        <div className="ap-banner-right">
          <div className="ap-stat">
            <span className="ap-stat-v">{score.phrases.length}</span>
            <span className="ap-stat-l">乐句</span>
          </div>
          <div className="ap-stat">
            <span className="ap-stat-v">{score.pedals.length}</span>
            <span className="ap-stat-l">踏板段</span>
          </div>
          <div className="ap-stat">
            <span className="ap-stat-v">{PIECE_SECTIONS.length}</span>
            <span className="ap-stat-l">结构段</span>
          </div>
        </div>
      </section>

      {/* ── 走带控制 ───────────────────────────────────────────── */}
      <section className="card card-pad ap-transport">
        <div className="ap-buttons">
          <button
            className={`btn btn-primary btn-lg${snap.playing ? ' ap-btn-active' : ''}`}
            // 不传参数 = 从曲首（含弱起）开始；传 0 会跳过弱起的 E–D♯
            onClick={() => (snap.playing ? player.pause() : snap.paused ? player.resume() : player.play())}
          >
            {snap.playing ? '❚❚ 暂停' : snap.paused ? '▶ 继续' : '▶ 完整演奏'}
          </button>
          <button className="btn btn-ghost" onClick={() => player.stop()} disabled={!snap.playing && !snap.paused}>
            ■ 停止
          </button>
          <button className="btn btn-ghost" onClick={() => player.seekBeat(Math.max(0, snap.currentBeat - 3 * score.beatsPerMeasure))}>
            « 后退 3 小节
          </button>
          <button className="btn btn-ghost" onClick={() => player.seekBeat(snap.currentBeat + 3 * score.beatsPerMeasure)}>
            前进 3 小节 »
          </button>
        </div>

        <div className="ap-progress-row">
          <span className="mono-num ap-time">{fmt(snap.currentTime)}</span>
          <div className="ap-progress-wrap">
            <input
              className="range ap-range"
              type="range"
              min={0}
              max={1000}
              value={Math.round(snap.progress * 1000)}
              onChange={onSeek}
              aria-label="播放进度"
            />
            <div className="ap-progress-fill" style={{ width: `${snap.progress * 100}%` }} />
          </div>
          <span className="mono-num ap-time">{fmt(snap.duration)}</span>
        </div>

        <div className="ap-status">
          <span className="pill">小节 {snap.currentMeasure}</span>
          <span className="pill pill-indigo">{snap.sectionLabel || '—'}</span>
          <span className={`pill ${snap.pedalDown ? 'pill-success' : ''}`}>
            踏板 {snap.pedalDown ? `踩下 ${Math.round(snap.pedalDepth * 100)}%` : '抬起'}
          </span>
          <span className="pill">{snap.bpm} 八分/分 ≈ ♩={quarterBpm}</span>
          {snap.finished && <span className="pill pill-amber">演奏结束</span>}
        </div>
      </section>

      {/* ── 琴键联动 ───────────────────────────────────────────── */}
      <section className="card card-pad ap-keyboard">
        <div className="ap-sec-head">
          <h3>琴键联动</h3>
          <span className="tiny">正在发声的音会实时点亮；你也可以直接点键盘试听</span>
        </div>
        <PianoKeyboard
          lowMidi={lowMidi}
          highMidi={highMidi}
          pressedMidis={active}
          showNoteNames
          height={150}
          onNoteOn={(m, v) => player.audition(m, v)}
          onNoteOff={(m) => player.auditionOff(m)}
        />
      </section>

      {/* ── 演奏参数 ───────────────────────────────────────────── */}
      <section className="card card-pad ap-controls">
        <div className="ap-sec-head">
          <h3>演奏参数</h3>
          <span className="tiny">速度可实时调整，已排入音频时钟但未发声的音会被撤销，不会跑出旧速度的音</span>
        </div>

        <div className="ap-sliders">
          <label className="ap-field">
            <span className="ap-label">音色（合成回退链路）</span>
            <select
              className="select"
              value={timbre}
              disabled={player.sampleEnabled}
              title={player.sampleEnabled ? '当前使用真实钢琴采样，音色由录音决定；此项仅在采样不可用时的合成回退链路上生效' : ''}
              onChange={(e) => {
                const v = e.target.value as PianoPreset
                setTimbre(v)
                player.setTimbre(v)
              }}
            >
              {(Object.keys(PRESETS) as PianoPreset[]).map((k) => (
                <option key={k} value={k}>
                  {PRESETS[k].label}
                </option>
              ))}
            </select>
          </label>

          <label className="ap-field">
            <span className="ap-label">
              音量 <b className="mono-num">{Math.round(volume * 100)}%</b>
            </span>
            <input
              className="range"
              type="range"
              min={0}
              max={100}
              value={Math.round(volume * 100)}
              onChange={(e) => {
                const v = Number(e.target.value) / 100
                setVolume(v)
                player.setVolume(v)
              }}
            />
          </label>

          <label className="ap-field">
            <span className="ap-label">
              速度 <b className="mono-num">{bpm}</b> 八分/分（≈ ♩={quarterBpm}）
            </span>
            <input
              className="range"
              type="range"
              min={60}
              max={160}
              value={bpm}
              onChange={(e) => {
                const v = Number(e.target.value)
                setBpm(v)
                player.setBpm(v)
              }}
            />
          </label>

          <label className="ap-field">
            <span className="ap-label">
              混响 <b className="mono-num">{Math.round(reverb * 100)}%</b>
            </span>
            <input
              className="range"
              type="range"
              min={0}
              max={70}
              value={Math.round(reverb * 100)}
              onChange={(e) => {
                const v = Number(e.target.value) / 100
                setReverb(v)
                player.setReverb(v)
              }}
            />
          </label>
        </div>

        {/* 音源状态：真实采样（首选）→ 合成回退 */}
        <div className="ap-source">
          <div className="ap-source-main">
            <span className={`ap-dot${srcState === 'ready' ? ' ok' : srcState === 'failed' ? ' bad' : ' busy'}`} />
            <b>{srcState === 'ready' || srcState === 'loading' ? player.sampleName || '真实钢琴采样' : '合成音源'}</b>
            <span className="tiny">
              {srcState === 'loading' &&
                `正在加载钢琴采样 ${srcPct}% · 本曲音高覆盖 ${Math.round(player.sampleCoverage * 100)}%`}
              {srcState === 'ready' &&
                `已就绪 · 音高覆盖 ${Math.round(player.sampleCoverage * 100)}% · 已解码 ${player.sampleStats.loaded} 个采样${
                  player.sampleStats.pending > 0 ? ` · 后台补齐 ${player.sampleStats.pending} 个力度层` : ''
                }`}
              {srcState === 'failed' && '未找到 public/samples/manifest.json，继续使用高质量合成音源'}
              {srcState === 'idle' && '已手动切回合成音源'}
            </span>
          </div>
          {srcState === 'loading' && (
            <div className="ap-source-bar">
              <i style={{ width: `${Math.max(4, srcPct)}%` }} />
            </div>
          )}
        </div>

        <div className="ap-switches">
          <label className="ap-switch">
            <input type="checkbox" checked={pedalOn} onChange={(e) => { setPedalOn(e.target.checked); player.setPedalEnabled(e.target.checked) }} />
            <span>延音踏板</span>
          </label>
          <label
            className="ap-switch"
            title={player.sampleEnabled ? '采样本身已录有真实踏板共鸣，此项在采样音源下自动停用（避免同一份泛音叠加两次导致发浑）' : ''}
          >
            <input
              type="checkbox"
              checked={resonanceOn && !player.sampleEnabled}
              disabled={player.sampleEnabled}
              onChange={(e) => { setResonanceOn(e.target.checked); player.setResonance(e.target.checked) }}
            />
            <span>踏板共鸣（仅合成音源）</span>
          </label>
          <button className="btn btn-sm btn-ghost" onClick={toggleSamples} disabled={sampleLoading || srcState === 'loading'}>
            {player.sampleEnabled ? '切回合成音源' : '切换到真实采样'}
          </button>
          {sampleMsg && <span className="tiny">{sampleMsg}</span>}
        </div>
      </section>

      {/* ── 结构导航 ───────────────────────────────────────────── */}
      <section className="card card-pad">
        <div className="ap-sec-head">
          <h3>曲式结构</h3>
          <span className="tiny">点击跳转到该段</span>
        </div>
        <div className="ap-sections">
          {PIECE_SECTIONS.map((s) => {
            const activeSection = snap.currentMeasure >= s.startMeasure && snap.currentMeasure <= s.endMeasure
            return (
              <button
                key={s.id + s.startMeasure}
                className={`ap-sec-card${activeSection ? ' active' : ''}`}
                onClick={() => jumpTo(s.startMeasure)}
              >
                <div className="ap-sec-form">{s.form}</div>
                <div className="ap-sec-name">{s.name.replace(/^第\s*\d+\s*章\s*·\s*/, '')}</div>
                <div className="tiny">m{s.startMeasure}–{s.endMeasure} · {s.key}</div>
              </button>
            )
          })}
        </div>
      </section>

      {/* ── 实现说明 ───────────────────────────────────────────── */}
      <section className="card card-pad ap-notes">
        <div className="ap-sec-head">
          <h3>实现取舍与可扩展方向</h3>
        </div>
        <ul className="ap-list">
          <li><b>音源：真实钢琴采样（默认启用）。</b>播放的是 Salamander Grand Piano V3（CC BY 3.0）的
            <b>三层力度录音</b>（p / mf / f），每 3 个半音一个采样点、播放时变速补全。合成引擎退居为
            <b>回退</b>：首次加载的一两秒、或某个音尚未就绪时才会短暂接管，保证"点了就有声"。
            采样资源在 <code>public/samples/</code>，清单格式与标定方法见该目录的 README。</li>
          <li><b>为什么不是"合成调得再好一点"：</b>纯合成缺的不是波形复杂度，而是真实录音里的
            琴体共鸣、弦间拍频与房间信息。听感上它永远带一层"电子味"，这是加性/FM 合成补不回来的。
            换到真实采样后，同一份时序与诠释数据立刻变成"能入耳"的钢琴。</li>
          <li><b>采样方案的四个隐蔽坑（都已在代码里处理）：</b>
            ① URL 里的 <code>#</code> 不编码会让所有升号音静默 404（含开头动机的 D♯）；
            ② mp3 解码后开头有 20~50ms 填充静音，不跳过就会"迟半个字"；
            ③ 原始采样长达 22 秒，不裁剪则解码后近 500MB，LRU 互踢导致音色忽好忽坏；
            ④ 三层录音响度差几个 dB，不做<b>层增益标定</b>就会在层交界处听到"台阶"。</li>
          <li><b>纵向：力度与踏板不是"数据"，是"推导"。</b>机读乐谱没有 dynamic 与踏板标记，因此新增诠释层
            <code>src/core/interpretation.ts</code>，从曲式、乐句呼吸、拍点、旋律位置推导力度；
            从左手和声签名变化推导换踏板。采样音源下人工共鸣自动停用——实录里本来就有。</li>
          <li><b>横向：时序不受渲染影响。</b>发声时刻一律排在 AudioContext 绝对时间轴上（25ms 前瞻调度），
            界面进度由 rAF 从音频时钟反算并节流到 20fps；主线程卡顿只会让高亮晚一点，不会让音跑偏。</li>
          <li><b>可验证性：</b><code>tools/autoplay-tone-check.mjs</code> 在真实浏览器里播放整曲，
            在最终输出节点旁路取样，量化给出峰值 / RMS / 静音帧 / 频谱分布 / 采样命中率；
            <code>tools/diag-score.mjs</code> 则用「乐谱应发声数 vs 实际 hits」核对是否漏音。</li>
        </ul>
      </section>
    </div>
  )
}

export default AutoPlayPage
