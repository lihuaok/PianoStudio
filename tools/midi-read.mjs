/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * midi-read.mjs — 极简 MIDI 读取（零依赖）
 *
 * 把 .mid 解析成「按轨分组的音符事件表」，为 tools/score-verify-midi.mjs
 * 提供**权威参照**。比手写的文本 dump 可靠——那份 dump 是二手产物。
 *
 * 用法：
 *   node tools/midi-read.mjs                       # 打印概览
 *   node tools/midi-read.mjs --txt=out.txt         # 导出文本
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const NM = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
export const noteName = (m) => NM[m % 12] + (Math.floor(m / 12) - 1)

function readVarLen(buf, i) {
  let value = 0
  for (let n = 0; n < 4; n++) {
    const b = buf[i++]
    value = (value << 7) | (b & 0x7f)
    if (!(b & 0x80)) break
  }
  return [value, i]
}

/** 解析 MIDI 文件，返回 { format, division, tracks: [{tick,dur,midi,velocity,chan}[]] } */
export function parseMidiFile(file) {
  const buf = fs.readFileSync(file)
  if (buf.slice(0, 4).toString('ascii') !== 'MThd') throw new Error('不是 MIDI 文件：' + file)
  const headerLen = buf.readUInt32BE(4)
  const format = buf.readUInt16BE(8)
  const ntracks = buf.readUInt16BE(10)
  const division = buf.readUInt16BE(12)

  let off = 8 + headerLen
  const tracks = []
  for (let t = 0; t < ntracks; t++) {
    const len = buf.readUInt32BE(off + 4)
    const start = off + 8
    const end = start + len
    let i = start
    let tick = 0
    let running = null
    const openNotes = new Map()
    const notes = []
    while (i < end) {
      let delta
      ;[delta, i] = readVarLen(buf, i)
      tick += delta
      let status = buf[i]
      if (status & 0x80) { running = status; i++ }
      else status = running
      const type = status & 0xf0
      // ⚠️ 顺序关键：meta 事件 status=0xFF 的 type 同样是 0xF0，
      // 若先判 sysex 分支会把 meta 误当成 sysex，读错长度后整轨 tick 全部错位。
      if (status === 0xff) {
        i++                                   // 跳过 meta type
        let l; [l, i] = readVarLen(buf, i)
        i += l
        continue
      }
      if (type === 0xf0 || type === 0xf7) {
        let l; [l, i] = readVarLen(buf, i); i += l
        continue
      }
      const chan = status & 0x0f
      const d1 = buf[i++]
      if (type === 0xc0 || type === 0xd0) continue
      const d2 = buf[i++]
      const key = `${chan}|${d1}`
      if (type === 0x90 && d2 > 0) {
        // 同音重叠：先把上一个收掉，避免丢音
        if (openNotes.has(key)) {
          const prev = openNotes.get(key)
          notes.push({ ...prev, dur: tick - prev.tick })
        }
        openNotes.set(key, { tick, velocity: d2, midi: d1, chan })
      } else if (type === 0x80 || (type === 0x90 && d2 === 0)) {
        const prev = openNotes.get(key)
        if (prev) { notes.push({ ...prev, dur: tick - prev.tick }); openNotes.delete(key) }
      }
    }
    notes.sort((a, b) => a.tick - b.tick || a.midi - b.midi)
    tracks.push(notes)
    off = end
  }
  return { format, division, tracks }
}

// ── CLI ─────────────────────────────────────────────────────────────────────
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const isCli = (() => {
  try { return path.resolve(process.argv[1] ?? '') === fileURLToPath(import.meta.url) } catch { return true }
})()

if (isCli) {
  const FILE = path.join(root, 'tools', 'scoredata', 'fur_Elise_WoO59.mid')
  const txtArg = process.argv.find((a) => a.startsWith('--txt='))
  const { format, division, tracks } = parseMidiFile(FILE)
  console.log(`format=${format} division=${division} tracks=${tracks.length}`)

  const melodic = tracks.map((n, i) => ({ i, n })).filter((x) => x.n.length > 0)
  console.log(`\n含音符的轨：${melodic.map((x) => `#${x.i}(${x.n.length})`).join(' ')}`)
  for (const x of melodic) {
    const last = Math.max(...x.n.map((a) => a.tick + a.dur))
    const lo = Math.min(...x.n.map((a) => a.midi))
    const hi = Math.max(...x.n.map((a) => a.midi))
    console.log(`  track#${x.i}: ${x.n.length} 音 · 末 tick ${last} · 音域 ${noteName(lo)}~${noteName(hi)}`)
  }

  if (txtArg) {
    const lines = ['# tools/midi-read.mjs from ' + path.basename(FILE), `# format=${format} division=${division}`, '']
    for (const x of melodic) {
      for (const n of x.n) {
        lines.push(`tick=${n.tick} dur=${n.dur} track=${x.i} note=${noteName(n.midi)} midi=${n.midi} velocity=${n.velocity}`)
      }
    }
    const out = txtArg.slice(6)
    fs.writeFileSync(out, lines.join('\n') + '\n', 'utf8')
    console.log(`\n已写出 ${melodic.reduce((s, x) => s + x.n.length, 0)} 行 → ${out}`)
  } else {
    for (const n of melodic[0].n.slice(0, 16)) {
      console.log(`  tick=${n.tick} dur=${n.dur} note=${noteName(n.midi)}`)
    }
  }
}
