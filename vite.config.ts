import { defineConfig } from 'vite'
import path from 'node:path'
import { readFileSync } from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const e2eCdpPort = process.env.LUNA_E2E_CDP_PORT ?? '9332'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        onstart: mode === 'e2e'
          ? ({ startup }) => startup(['.', '--no-sandbox', `--remote-debugging-port=${e2eCdpPort}`])
          : undefined,
        vite: {
          build: {
            rollupOptions: {
              output: {
                chunkFileNames: 'luna-[name].js',
              },
            },
          },
        },
      },
      preload: {
        // Shortcut of `build.rollupOptions.input`.
        // Preload scripts may contain Web assets, so use the `build.rollupOptions.input` instead `build.lib.entry`.
        input: path.join(__dirname, 'electron/preload.ts'),
      },
      // Ployfill the Electron and Node.js API for Renderer process.
      // If you want use Node.js in Renderer process, the `nodeIntegration` needs to be enabled in the Main process.
      // See 👉 https://github.com/electron-vite/vite-plugin-electron-renderer
      renderer:
        process.env.NODE_ENV === 'test'
          ? // https://github.com/electron-vite/vite-plugin-electron-renderer/issues/78#issuecomment-2053600808
            undefined
          : {},
    }),
  ],
}))
