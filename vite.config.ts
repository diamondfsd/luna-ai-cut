import { defineConfig } from 'vite'
import path from 'node:path'
import { cpSync, readFileSync } from 'node:fs'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import { inlineStartupVideo } from './scripts/vite-inline-startup-video'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))
const electronEntryPaths = new Set([
  path.resolve(__dirname, 'electron/main.ts'),
  path.resolve(__dirname, 'electron/appMain.ts'),
].map((entry) => entry.replaceAll('\\', '/')))

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

// Hot updates live outside app.asar, so Node cannot resolve installation-only
// dependencies relative to their JS files. Always resolve them from the app.
function installedElectronDependencies() {
  const prefix = '\0luna-installed:'
  return {
    name: 'luna-installed-electron-dependencies',
    // vite:resolve runs before ordinary plugins, so a bare specifier would
    // already be resolved into node_modules and inlined into the ESM output.
    // Only a pre plugin can take over `usb` / `ws` before that happens.
    enforce: 'pre' as const,
    resolveId(id: string) {
      return id === 'usb' || id === 'ws' ? `${prefix}${id}` : null
    },
    load(id: string) {
      if (!id.startsWith(prefix)) return null
      const dependency = id.slice(prefix.length)
      return `import { app } from 'electron';
import { createRequire } from 'node:module';
import { join } from 'node:path';
export default createRequire(join(app.getAppPath(), 'package.json'))(${JSON.stringify(dependency)});`
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  publicDir: false,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
  },
  plugins: [
    copyLocalShareAssets(),
    react(),
    electron({
      main: {
        entry: 'electron/main.ts',
        vite: {
          plugins: [inlineStartupVideo(), installedElectronDependencies()],
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
              // Keep bootstrap side effects in main.js, which is deliberately
              // excluded from hot archives; shared chunks must not boot again.
              preserveEntrySignatures: 'strict',
              output: {
                chunkFileNames: 'luna-[name].js',
                onlyExplicitManualChunks: true,
                manualChunks(id) {
                  if (electronEntryPaths.has(id.replaceAll('\\', '/'))) return
                  return 'runtime'
                },
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
