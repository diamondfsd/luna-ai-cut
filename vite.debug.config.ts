import { defineConfig } from 'vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

// 设备调试独立包构建配置
//
// 前端 → dist-debug/
// Electron 主进程 → dist-electron/（沿用主包路径，开发模式 electron 通过
//   package.json 的 "main" 字段定位入口，统一输出到 dist-electron/ 可避免
//   路径冲突。打包时 electron-builder-debug.json5 同时引用两个目录。）
//
export default defineConfig({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __DEBUG_STANDALONE__: JSON.stringify(true),
  },
  base: './',
  build: {
    outDir: 'dist-debug',
  },
  plugins: [
    react(),
    electron({
      main: {
        // 调试版入口，不含热更新等逻辑
        entry: 'electron/mainDebug.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              output: {
                entryFileNames: 'main.js',
                // 与主包区分 chunk 命名，避免热更新时串文件
                chunkFileNames: 'debug-[name].js',
              },
            },
          },
        },
      },
      preload: {
        input: path.join(__dirname, 'electron/preload.ts'),
        vite: {
          build: {
            outDir: 'dist-electron',
          },
        },
      },
      // 开发模式下不自动弹出 electron 窗口（由 appMainDebug 控制）
    }),
  ],
})
