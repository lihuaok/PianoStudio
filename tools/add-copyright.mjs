/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * 批量插入版权头（幂等，可反复运行）。
 *
 *   node tools/add-copyright.mjs            # 空跑：只列出将要改动的文件
 *   node tools/add-copyright.mjs --apply    # 真正写入
 *
 * 设计取舍：
 *  1. 只处理**第一方源码**（扩展名白名单）。JSON 不支持注释，改了会破坏文件 → 跳过；
 *     二进制（mp3/png…）无法写注释 → 跳过。
 *  2. **不碰第三方素材**：
 *     · public/samples/ —— Salamander Grand Piano V3，CC BY 3.0，版权属 Alexander Holm，
 *       署成 LIHUA 是错的；
 *     · tools/scoredata/ —— Mutopia 的贝多芬《致爱丽丝》LilyPond 底本与 MIDI 转储，公有领域；
 *     这两处已有各自的许可声明，本脚本整目录跳过。
 *  3. 注释风格随语言：JS/TS/CSS 用 `/*!`；Python 用 `#`；HTML/SVG/Markdown 用 `<!-- -->`。
 *     ⚠️ **光写 `/*!` 并不会在构建产物里保留**（实测：默认配置下 dist 里 0 命中，
 *     压缩器照样丢弃）。必须在 `vite.config.ts` 里显式配置
 *     `esbuild: { legalComments: 'inline' }` 才会随产物发布——已配，勿删。
 *  4. 插入位置尊重首行指令：shebang、`<!DOCTYPE>`、`<?xml ?>` 必须留在第 1 行，
 *     版权头插在它们之后（DOCTYPE 前插注释会让旧 IE 进 quirks 模式）。
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join, extname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const YEAR = 2026
const OWNER = 'LIHUA'
const EN = `Copyright (c) ${YEAR} ${OWNER}. All rights reserved.`
const ZH = `版权所有 (C) ${YEAR} ${OWNER}，保留所有权利。`

/** 只处理这些第一方源码扩展名 */
const ALLOWED_EXT = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.css', '.html', '.htm', '.svg', '.md', '.py',
])

/** 整目录跳过：第三方素材 / 依赖 / 构建产物 / 本地数据 */
const SKIP_DIRS = new Set([
  'node_modules', 'dist', '.git', '.workbuddy', '.vite',
  'samples',      // 第三方采样（CC BY 3.0）
  'scoredata',    // 第三方乐谱底本与 MIDI 转储
  'screenshots', '_edgeprof',
])

const APPLY = process.argv.includes('--apply')

function headerFor(ext) {
  if (ext === '.py') return `# ${EN}\n# ${ZH}`
  if (ext === '.html' || ext === '.htm' || ext === '.svg' || ext === '.md') {
    return `<!-- ${EN} ${ZH} -->`
  }
  // JS / TS / CSS：`/*!` 开头，构建压缩后仍保留
  return `/*!\n * ${EN}\n * ${ZH}\n */`
}

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) walk(full, out)
    else if (e.isFile()) out.push(full)
  }
  return out
}

const files = walk(ROOT).filter((f) => ALLOWED_EXT.has(extname(f).toLowerCase()))
const changed = []
const skipped = []

for (const file of files) {
  let raw = readFileSync(file, 'utf8')
  const bom = raw.charCodeAt(0) === 0xfeff
  const body = bom ? raw.slice(1) : raw

  // 幂等：已有版权头就跳过
  if (body.includes(EN) || body.includes(ZH)) { skipped.push(file); continue }

  const ext = extname(file).toLowerCase()
  const header = headerFor(ext)
  const lines = body.split('\n')
  const first = lines[0] ?? ''

  // 这些"必须首行"的指令之前不能插注释
  let idx = 0
  if (/^#!/.test(first) || /^<!DOCTYPE/i.test(first) || /^<\?xml/i.test(first)) idx = 1

  const head = idx > 0 ? lines.slice(0, idx).join('\n') + '\n' : ''
  const next = (bom ? '\ufeff' : '') + head + header + '\n\n' + lines.slice(idx).join('\n')

  changed.push(file)
  if (APPLY) writeFileSync(file, next, 'utf8')
}

const rel = (f) => relative(ROOT, f).split(sep).join('/')

console.log(APPLY ? '=== 已写入 ===' : '=== 空跑：将要写入 ===')
console.log(`改动 ${changed.length} 个文件，跳过（已有版权头）${skipped.length} 个\n`)
for (const f of changed) console.log('  ' + rel(f))

if (!APPLY) {
  console.log('\n（这是空跑，未写入任何文件。确认无误后加 --apply）')
}
