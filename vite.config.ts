import { defineConfig } from 'vite'
import path from 'node:path'
import { cpSync, readFileSync } from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const buildChannel = process.env.LUNA_BUILD_CHANNEL === 'test' ? 'test' : 'stable'

function copyLocalShareAssets() {
  return {
    name: 'copy-local-share-assets',
    apply: 'build' as const,
    closeBundle() {
      cpSync(
        path.resolve(__dirname, 'public/local-share'),
        path.resolve(__dirname, 'dist/local-share'),
        { recursive: true },
      )
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  publicDir: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __LUNA_BUILD_CHANNEL__: JSON.stringify(buildChannel),
  },
  plugins: [
    copyLocalShareAssets(),
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          base: './',
          worker: {
            format: 'es',
            rollupOptions: {
              external: [/^node:/, 'fs', 'crypto'],
              output: {
                banner: "import { fileURLToPath as __lunaFileURLToPath } from 'node:url'; import { dirname as __lunaDirname } from 'node:path'; const __dirname = __lunaDirname(__lunaFileURLToPath(import.meta.url));",
              },
            },
          },
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
})
