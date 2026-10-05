/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

/**
 * 公众号排版构建脚本（零依赖）
 *   node build.mjs
 *
 * 1. 读 charts/fig-0X-*.svg（工程制图级矢量图源）
 * 2. 把图内联注入 index.html 的 <!--FIG:1..4--> 占位处
 * 3. 重新生成 tools/fig-preview.html 与单图页 _out/fig-0X.html（供截图导出 PNG）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const charts = path.join(root, 'charts');
const OUT = path.join(root, '_out');

const FIGURES = [
  { no: 1, file: 'fig-01-capability-split.svg', cap: '上半区是语言能覆盖的，下半区是语言接不住的 —— 生成靠模型，可用靠人。' },
  { no: 2, file: 'fig-02-cognition-ceiling.svg', cap: '所以真正的瓶颈不在模型有多强，而在提问者的工程认知有多深。' },
  { no: 3, file: 'fig-03-hidden-defects.svg', cap: '一份"没报错"的 AI 代码，水面以下可能沉着四层窟窿。' },
  { no: 4, file: 'fig-04-prototype-vs-production.svg', cap: '把同一次生成，放到工程尺度上重算一遍，层序数会从 3 变 6。' },
];

const svgs = {};
for (const f of FIGURES) {
  const p = path.join(charts, f.file);
  if (!fs.existsSync(p)) { console.error('缺图：' + f.file); process.exit(1); }
  svgs[f.no] = fs.readFileSync(p, 'utf8').trim();
}

/* ---------- 1. index.html ---------- */
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
for (const f of FIGURES) {
  const token = `<!--FIG:${f.no}-->`;
  if (!html.includes(token)) { console.error('缺少占位 ' + token); process.exit(1); }
  const figure = `
  <section style="margin:26px 0 0;text-align:center;">
    <div style="max-width:677px;margin:0 auto;">${svgs[f.no]}</div>
  </section>
  <section style="margin:10px 0 20px;text-align:center;">
    <p style="margin:0;font-size:13px;line-height:1.8;color:#8A8578;">${f.cap}</p>
  </section>`;
  html = html.replace(token, figure);
}
html = html.replace(/<span id="figcount">4<\/span>/, `<span id="figcount">${FIGURES.length}</span>`);
fs.writeFileSync(path.join(root, 'index.html'), html, 'utf8');

/* ---------- 2. preview + 单图页 ---------- */
fs.mkdirSync(path.join(root, 'tools'), { recursive: true });
fs.mkdirSync(OUT, { recursive: true });
const H = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="UTF-8">';
const F = '</head><body style="margin:0;background:#fff;">';
const E = '</body></html>';
fs.writeFileSync(path.join(root, 'tools/fig-preview.html'), `${H}<style>body{margin:0;background:#EDEAE4;}
.blk{margin:18px auto;width:700px;background:#fff;box-shadow:0 2px 10px rgba(0,0,0,.06);}
.blk>svg{display:block;width:680px;height:360px;}
.h{height:38px;background:#FAF7F2;border-bottom:1px solid #E4E0D8;font:600 14px "Microsoft YaHei",sans-serif;color:#5C6B77;line-height:38px;padding:0 16px;box-sizing:border-box;}
.tail{height:20px;}</style></head><body>` +
  FIGURES.map(f => `<div class="blk"><div class="h">${f.file}</div>${svgs[f.no]}<div class="tail"></div></div>`).join('') + E, 'utf8');

for (const f of FIGURES) {
  fs.writeFileSync(path.join(OUT, `fig-0${f.no}.html`), `${H}${F}${svgs[f.no]}${E}`, 'utf8');
}

console.log('注入完成：' + FIGURES.length + ' 张图');
