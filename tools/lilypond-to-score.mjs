/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * lilypond-to-score.mjs
 * ---------------------------------------------------------------------------
 * 把 Mutopia Project 的权威 LilyPond 源（Für Elise，底本 Breitkopf & Härtel 1888）
 * 解析成 Piano Studio 内部的乐谱 JSON。
 *
 * 关键点：LilyPond 的小节线是**自动插入**的（源码里几乎没有显式 \bar），
 * 所以小节归属必须由「累计时值 ÷ 拍号」计算得出，而不是靠扫描 \bar 命令。
 *
 * 时值单位：ticks，1 tick = 一个十六分音符。3/8 一小节 = 3 * 12 = 36 ticks。
 *
 * 输出：src/data/furElise.json
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const LY_PATH = path.join(__dirname, 'scoredata', 'fur_elise.ly')
const DEFAULT_OUT = path.join(__dirname, '..', 'src', 'data', 'furElise.json')

const TICK_16 = 6                      // 一个十六分音符 = 6 ticks
const MEASURE_TICKS = 36               // 3/8 → 3 个八分 = 36 ticks
const PICKUP_TICKS = 12                // \partial 8 → 一个八分音符

const LETTER_SEMI = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }

/**
 * 折叠反复开关：`--collapse-repeats`。
 * LilyPond 直接输出的 MIDI 不展开 volta（body 只奏一遍，各 ending 顺序排开），
 * 验证脚本用它生成「与官方 MIDI 同构」的数据做逐音全等比对。
 * 默认（false）是**展开**，这才是真实演奏的形态。
 */
let COLLAPSE_REPEATS = process.argv.includes('--collapse-repeats') || process.env.REPEAT_MODE === 'collapse'

/**
 * 需要紧跟一个参数的 LilyPond 命令。只有名单内的命令才会吞噬后随 token，
 * 其余（力度记号 \pp / 奏法 \staccato / \slurUp 等）一律视为无参，
 * 避免把后面的音符或休止当成参数吃掉。
 */
const ARG_CMDS = new Set([
  'partial', 'clef', 'key', 'time', 'tempo', 'bar', 'set', 'once', 'override',
  'revert', 'ottava', 'tuplet', 'times', 'tupletSpan', 'ottavation', 'change',
  'autochange', 'new', 'context', 'with', 'numericTimeSignature', 'compressMMRests',
])

function lilyAlter(token) {
  // 注意：本正则**只有一个**捕获组，取 m[1]。
  // 曾误写成 m[2]（恒为 undefined）→ 全曲所有升降号被吞掉，
  // 《致爱丽丝》的 D♯/G♯ 全部退化成 D/G，弹出来完全不是原曲。
  const m = /^[a-g](isis|is|eses|es)?/.exec(token)
  const acc = m?.[1] ?? ''
  if (acc === 'isis') return 2
  if (acc === 'is') return 1
  if (acc === 'eses') return -2
  if (acc === 'es') return -1
  return 0
}

function lilyLetter(token) {
  const m = /^([a-g])/.exec(token)
  return m ? m[1].toUpperCase() : 'C'
}

/** LilyPond 音高记号 → MIDI（c' = C4 = 60, c = C3 = 48） */
function lilyPitch(token) {
  const m = /^([a-g])(isis|is|eses|es)?([',]*)$/.exec(token)
  if (!m) return null
  const letter = m[1]
  const alter = lilyAlter(token)
  const marks = m[3] ?? ''
  // 每个 ' 或 , 提升/降低一个八度
  let shift = 0
  for (const ch of marks) {
    if (ch === "'") shift += 1
    else if (ch === ',') shift -= 1
  }
  return 48 + shift * 12 + LETTER_SEMI[letter] + alter
}

const DUR_BASE = { 1: 96, 2: 48, 4: 24, 8: 12, 16: 6, 32: 3, 64: 1.5 }

function durationTicks(base, dots) {
  let total = base
  let add = base
  for (let i = 0; i < dots; i++) {
    add /= 2
    total += add
  }
  return total
}

// ── 词法分析 ────────────────────────────────────────────────────────────────
// 注意：tokenize 接收的是**整段 staff 文本（含换行）**，不是单行。
// 曾经按行切分，于是 `\repeat volta 2 {` 这个跨行的花括号块被截断成空 body，
// 反复记号连同其全部内容被静默丢弃——乐曲只奏一遍，大量乐句凭空消失。
function tokenize(line) {
  const tokens = []
  let i = 0
  while (i < line.length) {
    const ch = line[i]
    if (/\s/.test(ch)) { i++; continue }
    if (ch === '%' && line[i + 1] === '{') {
      const end = line.indexOf('%}', i + 2)
      i = end < 0 ? line.length : end + 2
      continue
    }
    if (ch === '%') {
      const nl = line.indexOf('\n', i)
      i = nl < 0 ? line.length : nl + 1
      continue
    }
    if (ch === '"') {
      const endQuote = line.indexOf('"', i + 1)
      i = endQuote < 0 ? line.length : endQuote + 1
      continue
    }
    // Scheme 表达式：`#(...)`、`#'...`、`##t`、`#123`
    // 必须整体跳过——否则逐字符扫描时会把 `ly:make-moment` 里的 a/e/e
    // 当成音符，凭空生出三个错音（本次 bug 的直接来源之一）。
    if (ch === '#') {
      if (line[i + 1] === '{') {
        const end = line.indexOf('#}', i + 2)
        i = end < 0 ? line.length : end + 2
        continue
      }
      let j = i + 1
      if (line[j] === "'" || line[j] === '#') j++
      if (line[j] === '(') {
        let depth = 0
        while (j < line.length) {
          if (line[j] === '(') depth++
          else if (line[j] === ')') { depth--; if (depth === 0) { j++; break } }
          j++
        }
        i = j
        continue
      }
      const sm = /^#[^\s]+/.exec(line.slice(i))
      if (sm) { i += sm[0].length; continue }
    }
    if (ch === '\\') {
      let j = i + 1
      while (j < line.length && /[A-Za-z]/.test(line[j])) j++
      const cmd = line.slice(i + 1, j)
      i = j
      // `\repeat volta 2 { ... }`：`volta 2` 是两个 token 且后面紧跟 `{`，
      // 必须在检测花括号**之前**先把参数读出来，否则 times 拿不到，反复就不展开。
      let repeatArg = null
      if (cmd === 'repeat') {
        const rm = /^\s*(volta\s+\d+|unfold|percent\s+\d+|tremolo\s+\d+)/.exec(line.slice(i))
        if (rm) { repeatArg = rm[1]; i += rm[0].length }
      }
      let k = i
      while (k < line.length && /\s/.test(line[k])) k++
      if (line[k] === '{') {
        let depth = 0, start = k
        while (k < line.length) {
          if (line[k] === '{') depth++
          else if (line[k] === '}') { depth--; if (depth === 0) { k++; break } }
          k++
        }
        tokens.push({ type: 'cmd', cmd, arg: repeatArg, body: line.slice(start + 1, k - 1) })
        i = k
      } else {
        // 曾无条件吞参：于是 `r8\pp R4.` 里的 `\pp`（力度记号，无参）
        // 把紧随的 `R4.`（全小节休止）当成自己的参数吃掉，
        // 导致左手每一次全小节休止都不算时值，声部逐渐前移。
        let arg = null
        if (ARG_CMDS.has(cmd)) {
          const am = /^\s*([^\s{]+)/.exec(line.slice(i))
          if (am) { arg = am[1]; i += am[0].length }
        }
        // ★ 参数**之后**还可能跟着一个花括号组：`\tuplet 3/2 { ... }`。
        // 若不把它收进来，组内的音就被当成普通顶层音解析：
        // 三连音缩放失效（`a16` 仍是 96 ticks 而不是 64），
        // 整段十六分音符组比官方晚且拖长，一直错到段尾。
        let bg = i
        while (bg < line.length && /\s/.test(line[bg])) bg++
        if (line[bg] === '{') {
          let depth = 0, start = bg
          while (bg < line.length) {
            if (line[bg] === '{') depth++
            else if (line[bg] === '}') { depth--; if (depth === 0) { bg++; break } }
            bg++
          }
          tokens.push({ type: 'cmd', cmd, arg, body: line.slice(start + 1, bg - 1) })
          i = bg
        } else {
          tokens.push({ type: 'cmd', cmd, arg })
        }
      }
      continue
    }
    if (ch === '<') {
      let depth = 0, j = i, gt = -1
      while (j < line.length) {
        if (line[j] === '<') depth++
        else if (line[j] === '>') { depth--; if (depth === 0) { gt = j; j++; break } }
        j++
      }
      if (gt < 0) { i = line.length; continue } // 未闭合：放弃本行余部
      // ★ 时值写在尖括号**外面**：`<c' e'>8`、`<gis b>8 r r`。
      // 曾经不收这个后缀数字 → 和弦回退到「继承上一个音的时值」，
      // 于是本该是八分/四分的和弦全按十六分算，整段提前半拍并持续错位。
      const body = line.slice(i + 1, gt)
      const cdm = /^(\d+\.*)/.exec(line.slice(j))
      i = cdm ? j + cdm[0].length : j
      tokens.push({ type: 'chord', body, dur: cdm ? cdm[1] : null })
      continue
      continue
    }
    if ('[]()_^'.includes(ch)) { tokens.push({ type: 'artic', value: ch }); i++; continue }
    const pm = /^([a-g])(isis|is|eses|es)?([',]*)([0-9]*\.?[0-9]*)/.exec(line.slice(i))
    if (pm && pm[1]) {
      tokens.push({ type: 'note', pitch: pm[1] + (pm[2] ?? '') + pm[3], dur: pm[4] || null })
      i += pm[0].length
      continue
    }
    // LilyPond：r/R = 休止，s/S = 占位休止（skip）。
    // **两者都推进时间**——大小写不分。
    // 曾写成只识别小写 [rs]，大写 R 落到别的分支，再被当作「不推进时间的 skip」，
    // 于是每个 R4.（全小节休止）都让该声部少算 36 ticks，
    // 左手因此比右手提前一整个小节，弹出来错得离谱。
    const rm = /^([rRsS])([0-9]*\.?[0-9]*)/.exec(line.slice(i))
    if (rm) {
      const upper = rm[1].toUpperCase()
      tokens.push({ type: upper === 'R' ? 'rest' : 'skip', dur: rm[2] || null })
      i += rm[0].length
      continue
    }
    if (/[A-Z!^]/.test(ch)) {
      const wm = /^[A-Za-z!]+/.exec(line.slice(i))
      if (wm) { tokens.push({ type: 'word', value: wm[0] }); i += wm[0].length; continue }
    }
    i++
  }
  return tokens
}

/**
 * 把 `{A}{B}{C}` 拆成 ['A','B','C']（按顶层花括号平衡切分）。
 * 用于 \alternative { {第一遍} {第二遍} }。
 */
function splitBraceGroups(body) {
  const out = []
  let depth = 0
  let start = -1
  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '{') { if (depth === 0) start = i + 1; depth++ }
    else if (ch === '}') {
      depth--
      if (depth === 0 && start >= 0) { out.push(body.slice(start, i)); start = -1 }
    }
  }
  return out.filter((s) => s.trim().length > 0)
}

// ── 解析 ────────────────────────────────────────────────────────────────────
function parseStream(body, state, hand) {
  let lastDur = 8
  let ottava = 0
  let inGrace = false
  let dynamics = null
  let slur = null
  let pedal = false
  /**
   * 待应用的装饰音：`\appoggiatura bes'32 a'32[...]` 这种**不带花括号**的写法，
   * 语法上是「作用于紧随其后的那一个音」，而不是一个 braced body。
   * 以前它被当成无参命令忽略 → 后面的 bes'32 当成普通音占满三十二分，
   * 整条旋律从此比官方 MIDI 晚一个音位，一直错到段尾。
   */
  let pendingGrace = null

  const tokens = tokenize(body)
  for (let ti = 0; ti < tokens.length; ti++) {
    const tk = tokens[ti]
    if (tk.type === 'cmd') {
      const cmd = tk.cmd
      switch (cmd) {
        case 'partial': {
          const n = Number(tk.arg ?? 8)
          // partial 表示前一小节不满；记为 pickup
          state.pickupTicks = (DUR_BASE[n] ?? 12)
          break
        }
        case 'repeat': {
          // `\repeat volta N { A } \alternative { {B1} {B2} }` → A B1  A B2
          // MIDI / 实际演奏都是**写开**的，所以这里必须展开，否则会丢掉整段反复。
          const argStr = tk.arg ?? ''
          const vm = /volta\s+(\d+)/.exec(argStr)
          const pm = /percent\s+(\d+)/.exec(argStr)
          const times = vm ? +vm[1] : pm ? +pm[1] : /unfold/.test(argStr) ? 1 : 2

          // 向前找紧跟的 \alternative（它是 repeat 的兄弟 token）
          let altToken = null
          for (let j = ti + 1; j < tokens.length; j++) {
            const nj = tokens[j]
            if (nj.type !== 'cmd') continue
            if (nj.cmd === 'alternative') { altToken = nj; ti = j; break }
            // 允许夹 
            if (!['clef', 'key', 'time', 'once', 'override', 'set', 'bar', 'posPedal', 'posDynTxt', 'break', 'pageBreak'].includes(nj.cmd)) break
          }
          const alts = altToken?.body ? splitBraceGroups(altToken.body) : []

          if (COLLAPSE_REPEATS) {
            // 折叠模式：复刻 LilyPond 直接输出的 MIDI 形态（body + 各 volta 结尾，body 只奏一遍）。
            // 仅供 tools/score-verify-midi.mjs 做逐音全等校验使用；
            // 实际演奏必须用展开版——《致爱丽丝》A 段是要奏两遍的。
            if (tk.body) parseStream(tk.body, state, hand)
            for (const alt of alts) parseStream(alt, state, hand)
            break
          }

          for (let k = 0; k < times; k++) {
            if (tk.body) parseStream(tk.body, state, hand)
            const picked = alts.length ? alts[Math.min(k, alts.length - 1)] : null
            if (picked) parseStream(picked, state, hand)
          }
          break
        }
        case 'alternative': {
          // 正常情况下已在 `repeat` 分支里消费掉了；
          // 单独出现时退化为「只取第一遍」，保证不会误丢内容。
          if (tk.body) {
            const first = splitBraceGroups(tk.body)[0]
            if (first) parseStream(first, state, hand)
          }
          break
        }
        case 'tuplet': {
          // `\tuplet 3/2 { ... }`：3 个音挤进 2 个音的时间 → 每个音 ×2/3。
          // 两个曾犯的错：
          //   1) tuplet 存在 parseStream 的局部变量里，递归调用拿不到 → 缩放从未生效；
          //      必须挂在 state 上，让嵌套的 parseStream 也能读到。
          //   2) 比例写反成了 num/den（×3/2），把三连音拉长，后面的音全线推迟。
          const m = /^(\d+)\/(\d+)$/.exec(tk.arg ?? '')
          if (m) state.tuplet = { num: +m[1], den: +m[2] }
          if (tk.body) parseStream(tk.body, state, hand)
          state.tuplet = null
          break
        }
          case 'ottava': {
            const m = /#(-?\d)/.exec(tk.arg ?? tk.body ?? '')
            ottava = m ? parseInt(m[1], 10) : 0
            break
          }
          case 'grace':
          case 'appoggiatura':
          case 'acciaccatura': {
            if (!tk.body) { pendingGrace = cmd; break } // 无花括号 → 作用于下一个音
            /**
             * `\grace { f'16[ a'] } c''4`：倚音必须排在**主音之前**，
             * 且时值是从**前一个音**身上匀出来的（LilyPond 的官方 MIDI 就是如此：
             * 前一个和弦 96→52，两个倚音各占 22，然后主音 c''4 才原样落在拍点上）。
             *
             * 之前的实现有两个错：
             *   1) 递归调用自身的记号-independent 局部变量，`inGrace` 传不进子作用域
             *      → 倚音照常推进 tick，主音反而与倚音同时起音；
             *   2) 解析完又 `state.tick = saved` 回卷，于是倚音被塞在主音**之后**，
             *      听感上凭空多出两个重音，旋律线被截断。
             */
            if (tk.body) {
              // ① 先在隔离的时间轴上试跑一遍，量出倚音自身的时值
              const probe = { tick: 0, notes: [], pickupTicks: state.pickupTicks, pedal: [] }
              parseStream(tk.body, probe, hand)
              if (probe.notes.length) {
                const at = state.tick
                // ② 找出紧邻在前、结束点正好落在 at 的音（和弦是一个条目）
                const prev = []
                for (let i = state.notes.length - 1; i >= 0; i--) {
                  if (state.notes[i].absTick + state.notes[i].duration === at) prev.push(state.notes[i])
                  else break
                }
                let slop = 0
                if (prev.length) {
                  const prevDur = prev[0].duration
                  slop = Math.round(prevDur / 2)
                  const shortened = Math.max(prevDur - slop, Math.round(prevDur * 0.25))
                  slop = prevDur - shortened
                  for (const p of prev) { p.duration = shortened; p.slop = true }
                }
                // ③ 把倚音等分塞进这段「借来的时间」，排在 at 之前
                const unit = slop / probe.notes.length
                probe.notes.forEach((g, idx) => {
                  state.notes.push({
                    ...g,
                    absTick: at - slop + Math.round(idx * unit),
                    duration: Math.max(1, Math.round(unit)),
                    ornament: cmd,
                  })
                })
              }
            }
            break
          }
          case 'sustainPedal': {
            pedal = /Ped\}/.test(tk.body ?? '')
            if (pedal) state.pedal.push({ tick: state.tick })
            break
          }
          case 'clef':
          case 'key':
          case 'time':
          case 'tempo':
          case 'set':
          case 'override':
          case 'once':
          case 'markup':
          case 'hideTupletNumber':
          case 'tupletSpan':
          case 'break':
          case 'pageBreak':
          case 'ottavation':
          case 'posPedal':
          case 'posDynTxt':
            if (tk.body && (cmd === 'clef')) { /* 忽略谱号切换，音高已是绝对值 */ }
            break
          default:
            if (tk.body) parseStream(tk.body, state, hand)
        }
        continue
      }

      if (tk.type === 'word') {
        if (/^(ppp|pp|p|mp|mf|f|ff|fff)$/.test(tk.value)) dynamics = tk.value
        continue
      }
      // skip（s/S 占位）与 rest 一样推进时间网格，只是不发声。
      if (tk.type === 'artic') continue

      if (tk.type === 'rest' || tk.type === 'note' || tk.type === 'chord') {
        const pitches = []
        let durNum = null

        if (tk.type === 'chord') {
          for (const it of tokenize(tk.body)) {
            if (it.type === 'note') { pitches.push(it.pitch); if (it.dur) durNum = it.dur }
          }
          // 尖括号外的时值优先于括号内各音自带的时值
          if (tk.dur) durNum = tk.dur
        } else {
          if (tk.type === 'note') pitches.push(tk.pitch)
          if (tk.dur) durNum = tk.dur
        }

        let base = 8, dots = 0
        if (durNum) {
          const dm = /^(\d+)(\.*)$/.exec(durNum)
          if (dm) { base = +dm[1]; dots = dm[2].length; lastDur = base }
          else {
            const pm = /^(\d+)\.(\d+)$/.exec(durNum)
            if (pm) { base = +pm[1]; dots = 1; lastDur = base }
          }
        } else base = lastDur

        let ticks = durationTicks((DUR_BASE[base] ?? 12), dots)
  const tup = state.tuplet
  const isTuplet = !!tup && !inGrace
  if (isTuplet) ticks = ticks * (tup.den / tup.num)

        if (pendingGrace) {
          // 装饰音：不占独立拍位，从**前一个音**的尾巴上匀一点时间出来。
          const cmd = pendingGrace
          pendingGrace = null
          const at = state.tick
          const gdur = Math.max(1, Math.round(ticks * 0.25))
          const prev = []
          for (let i = state.notes.length - 1; i >= 0; i--) {
            if (state.notes[i].absTick + state.notes[i].duration === at) prev.push(state.notes[i])
            else break
          }
          if (prev.length) {
            const prevDur = prev[0].duration
            const shortened = Math.max(prevDur - gdur, Math.round(prevDur * 0.25))
            for (const p of prev) { p.duration = shortened; p.slop = true }
          }
          const midis = pitches.map(lilyPitch).filter((v) => v !== null)
          if (midis.length) {
            const adjusted = ottava > 0 ? midis.map((m) => m - 12) : midis
            state.notes.push({
              absTick: at - gdur,
              duration: gdur,
              midi: Math.min(...adjusted),
              hand,
              isChord: adjusted.length > 1,
              chord: adjusted.length > 1 ? adjusted.slice().sort((a, b) => a - b) : undefined,
              letter: lilyLetter(pitches[0]),
              alter: lilyAlter(pitches[0]),
              ornament: cmd,
              dynamic: dynamics ?? undefined,
            })
          }
          continue // 不推进时间网格
        }

        if (tk.type === 'rest') { state.tick += ticks; continue }

        const midis = pitches.map(lilyPitch).filter((v) => v !== null)
        if (!midis.length) continue
        // `\ottava #1` 只是**记谱**上的八度位移（画个 8va），MIDI 发音仍是
        // 写下的那个音——第 74 行那段华彩写的是 a''/c'''/e'''，官方 MIDI 就是
        // A5/C6/E6，不做任何搬移。曾经多做 ±12 的处理，整段忽高忽低一个八度。
        void ottava
        const adjusted = midis

        const abs = state.tick
        const note = {
          absTick: abs,
          duration: ticks,
          midi: Math.min(...adjusted),
          hand,
          isChord: adjusted.length > 1,
          chord: adjusted.length > 1 ? adjusted.slice().sort((a, b) => a - b) : undefined,
          letter: lilyLetter(pitches[0]),
          alter: lilyAlter(pitches[0]),
          tuplet: isTuplet || undefined,
          ornament: inGrace ? 'appoggiatura' : undefined,
          dynamic: dynamics ?? undefined,
        }
        state.notes.push(note)
        // 倚音不推进时值网格：把它记到当前时间点，但 tick 前进已在调用侧还原
        if (!inGrace) state.tick += ticks
      }
      void slur
  }
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
export function main(opts = {}) {
  const LY = opts.lyPath ?? LY_PATH
  const OUT_PATH = opts.out ?? DEFAULT_OUT
  const COLLAPSE = opts.collapse ?? COLLAPSE_REPEATS
  const quiet = !!opts.quiet
  COLLAPSE_REPEATS = COLLAPSE // parseStream 直接读模块级变量，这里同步一次
  const src = fs.readFileSync(LY, 'utf8')

  const upStart = src.indexOf('\\new Staff = "up"')
  const downStart = src.indexOf('\\new Staff = "down"')
  const endIdx = src.lastIndexOf('\\layout') > 0 ? src.lastIndexOf('\\layout') : src.length

  const upBody = src.slice(src.indexOf('{', upStart) + 1, downStart)
  const downBody = src.slice(src.indexOf('{', downStart) + 1, endIdx)

  // 注意：**不能**从 \partial 处切——Mutopia 这份谱的第一个 `\repeat volta 2 {`
  // 就写在 \partial 之前，切了就等于把这个反复块的声明连同其后内容一起丢弃。
  const cleanUp = upBody
  const cleanDown = downBody

  const stateUp = { tick: 0, notes: [], pickupTicks: PICKUP_TICKS, pedal: [] }
  const stateDown = { tick: 0, notes: [], pickupTicks: PICKUP_TICKS, pedal: [] }

  // ONLY_STAFF=up|down：调试用，只解析一个声部
  const ONLY = process.env.ONLY_STAFF
  if (ONLY !== 'down') parseStream(cleanUp, stateUp, 'right')
  if (ONLY !== 'up') parseStream(cleanDown, stateDown, 'left')

  // ── 由累计时值计算小节归属 ────────────────────────────────────────────────
  function assignMeasures(notes) {
    return notes.map((n) => {
      const afterPickup = n.absTick - stateUp.pickupTicks
      if (afterPickup < 0) {
        return { ...n, measure: 0, onset: n.absTick, isPickup: true }
      }
      const m = Math.floor(afterPickup / MEASURE_TICKS)
      return { ...n, measure: m + 1, onset: afterPickup - m * MEASURE_TICKS }
    })
  }

  const all = [...assignMeasures(stateUp.notes), ...assignMeasures(stateDown.notes)]
    .sort((a, b) => a.measure - b.measure || a.onset - b.onset || a.hand.localeCompare(b.hand))

  // ── 倚音后处理 ────────────────────────────────────────────────────────────
  // LilyPond 的 \grace 内音符虽然语法上被正确识别，但当它出现在
  // \alternative / 复合行内时上下文会丢失。这里用**音乐语义**判定：
  // 同一手、同一小节内，一个短音与随后的长音起点重叠（onset 早于且 duration 更短）
  // → 标记为倚音（装饰音），它在时值网格上不占独立位置。
  function markOrnaments(notes) {
    const bySlot = new Map()
    for (const n of notes) {
      const key = `${n.measure}|${n.hand}`
      if (!bySlot.has(key)) bySlot.set(key, [])
      bySlot.get(key).push(n)
    }
    let marked = 0
    for (const group of bySlot.values()) {
      group.sort((a, b) => a.onset - b.onset || b.duration - a.duration)
      for (const n of group) {
        if (n.ornament) continue
        // 找是否存在「起始更早或相同、且时值明显更短、并在 n 结束前起音」的长音
        const overlapped = group.some(
          (o) =>
            o !== n &&
            o.duration > n.duration * 2 &&
            o.onset <= n.onset &&
            o.onset + o.duration > n.onset + n.duration &&
            o.midi !== n.midi,
        )
        if (overlapped) {
          n.ornament = 'appoggiatura'
          marked++
        }
      }
    }
    return marked
  }
  const ornamentCount = markOrnaments(all)

  const totalMeasures = Math.max(...all.map((n) => n.measure))
  const rh = all.filter((n) => n.hand === 'right')
  const lh = all.filter((n) => n.hand === 'left')

  const out = {
    meta: {
      title: '致爱丽丝',
      titleOriginal: 'Für Elise',
      subtitle: 'A 小调巴加泰勒 · WoO 59',
      composer: '路德维希 · 范 · 贝多芬',
      year: '1810',
      catalog: 'WoO 59',
      key: 'a小调',
      timeSignature: [3, 8],
      tempoMark: 'Poco moto',
      defaultBpm: 72,
      totalMeasures,
      tickPerMeasure: MEASURE_TICKS,
      source: 'Mutopia Project · Mutopia-2015/08/18-931（底本 Breitkopf & Härtel 1888）· 公有领域',
    },
    notes: all,
  }

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true })
  fs.writeFileSync(OUT_PATH, JSON.stringify(out), 'utf8')

  if (quiet) return out

  console.log(`音符总数 ${all.length}（右手 ${rh.length} / 左手 ${lh.length}）`)
  console.log(`小节数 ${totalMeasures} · 装饰音 ${ornamentCount}`)
  const fmt = (arr) => arr.map((n) => `${n.midi}@${n.onset.toFixed(1)}/${n.duration.toFixed(1)}`).join(' ')
  for (let m = 0; m <= 8; m++) {
    console.log(`m${m} RH: ${fmt(all.filter((n) => n.measure === m && n.hand === 'right'))}`)
    console.log(`     LH: ${fmt(all.filter((n) => n.measure === m && n.hand === 'left'))}`)
  }
  console.log('--- 小节音数分布（检测是否漂移） ---')
  for (let m = 0; m <= 30; m++) {
    const c = all.filter((n) => n.measure === m)
    console.log(`m${m}: ${c.length} 音  (RH ${c.filter((n) => n.hand === 'right').length} / LH ${c.filter((n) => n.hand === 'left').length})`)
  }
  return out
}

const isDirectRun = (() => {
  try { return path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url) } catch { return true }
})()
if (isDirectRun) main()

export { tokenize, parseStream, lilyPitch, lilyAlter, lilyLetter, splitBraceGroups, durationTicks, DUR_BASE }
