/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * geom-keyhit-test.mjs — 验证 PianoKeyboard 命中判定修复
 * 模拟：在真实容器宽度下点击每个键的中心点，必须命中该键本身。
 */
const whiteCount = 22 // 音域 48–84（C3–C6）的白键数
const range = { low: 48, high: 84 }
const widthPx = 1180 // 曲目库页面的实际容器宽度

const blackW = (100 / whiteCount) * 0.62

// 构建键位（与 PianoKeyboard.tsx 相同逻辑）
const whiteKeys = []
const blackKeys = []
let wi = 0
for (let m = range.low; m <= range.high; m++) {
  const black = [1, 3, 6, 8, 10].includes(m % 12)
  if (black) blackKeys.push({ midi: m, whiteIndex: wi - 1 })
  else whiteKeys.push({ midi: m, whiteIndex: wi++ })
}
const whiteW = 100 / whiteCount

// ── 修复后的命中函数（百分比坐标系） ──────────────────────────────────────
function hitFixed(xPx, yRatio) {
  const xPct = (xPx / widthPx) * 100
  for (const bk of blackKeys) {
    const left = (bk.whiteIndex + 1) * whiteW - blackW / 2
    if (xPct >= left && xPct <= left + blackW && yRatio <= 0.62) return bk.midi
  }
  const i = Math.max(0, Math.min(whiteKeys.length - 1, Math.floor(xPct / whiteW)))
  return whiteKeys[i].midi
}

// ── 修复前的命中函数（像素 vs 百分比混用） ────────────────────────────────
function hitOld(xPx, yRatio) {
  const x = xPx
  for (const bk of blackKeys) {
    const left = (bk.whiteIndex + 1) * whiteW - blackW / 2
    if (x >= left && x <= left + blackW && yRatio <= 0.62) return bk.midi
  }
  const i = Math.max(0, Math.min(whiteKeys.length - 1, Math.floor(x / whiteW)))
  return whiteKeys[i].midi
}

let pass = 0, fail = 0
let oldPass = 0, oldFail = 0

// 白键：点击每个白键中心（避开黑键区 → 点键面下半部）
whiteKeys.forEach((k, i) => {
  const xPx = (i + 0.5) * (widthPx / whiteCount)
  const got = hitFixed(xPx, 0.8)
  if (got === k.midi) pass++
  else { fail++; console.log(`  ✗ 白键 ${k.midi}: 命中 ${got}`) }
  const old = hitOld(xPx, 0.8)
  if (old === k.midi) oldPass++
  else oldFail++
})

// 黑键：点击每个黑键中心
blackKeys.forEach((bk) => {
  const leftPct = (bk.whiteIndex + 1) * whiteW - blackW / 2
  const xPx = ((leftPct + blackW / 2) / 100) * widthPx
  const got = hitFixed(xPx, 0.3)
  if (got === bk.midi) pass++
  else { fail++; console.log(`  ✗ 黑键 ${bk.midi}: 命中 ${got}`) }
  const old = hitOld(xPx, 0.3)
  if (old === bk.midi) oldPass++
  else oldFail++
})

console.log(`修复后: ${pass} 通过 / ${fail} 失败`)
console.log(`修复前: ${oldPass} 通过 / ${oldFail} 失败（即「按键错位」的实际严重程度）`)
process.exit(fail === 0 ? 0 : 1)
