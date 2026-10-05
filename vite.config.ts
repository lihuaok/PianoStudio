/*!
 * Copyright (c) 2026 LIHUA. All rights reserved.
 * 版权所有 (C) 2026 LIHUA，保留所有权利。
 */

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(process.cwd(), 'src') },
  },
  server: {
    port: 5178,
    host: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8791',
        changeOrigin: true,
      },
    },
  },
  // 保留版权头：默认压缩器会把 /*! ... */ 全部丢弃，实测 dist 里 0 命中。
  // 'inline' = 就地保留在文件顶部（比 'eof' 移到末尾更醒目）。
  esbuild: {
    legalComments: 'inline',
  },
  build: {
    target: 'es2020',
    outDir: 'dist',
    assetsInlineLimit: 8192,
    chunkSizeWarningLimit: 1400,
  },
})
