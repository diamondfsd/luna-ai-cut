import { defineConfig } from 'vite'
import path from 'node:path'
import { createReadStream, existsSync, mkdirSync, statSync, cpSync, readFileSync } from 'node:fs'
import { extname, join, normalize, relative } from 'node:path'
import electron from 'vite-plugin-electron/simple'
import react from '@vitejs/plugin-react'
import type { ViteDevServer } from 'vite'

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf-8'))

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

function copyOpenReelAssets() {
  return {
    name: 'copy-openreel-assets',
    apply: 'build' as const,
    closeBundle() {
      const targetDir = path.resolve(__dirname, 'dist/ai-editor')
      cpSync(
        path.resolve(__dirname, 'vendor/openreel/apps/web/dist'),
        targetDir,
        { recursive: true },
      )
      const licenseDir = path.join(targetDir, 'LICENSES')
      mkdirSync(licenseDir, { recursive: true })
      cpSync(
        path.resolve(__dirname, 'vendor/openreel/LICENSE'),
        path.join(licenseDir, 'OpenReel-LICENSE'),
      )
    },
  }
}

function serveOpenReelAssets() {
  const openreelDist = path.resolve(__dirname, 'vendor/openreel/apps/web/dist')
  const contentTypes: Record<string, string> = {
    '.css': 'text/css; charset=utf-8',
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.map': 'application/json; charset=utf-8',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.wasm': 'application/wasm',
    '.webm': 'video/webm',
    '.woff': 'font/woff',
    '.woff2': 'font/woff2',
  }

  return {
    name: 'serve-openreel-assets',
    configureServer(server: ViteDevServer) {
      server.middlewares.use('/ai-editor', (req, res, next) => {
        const requestPath = req.url?.split('?')[0] ?? '/index.html'
        let decodedPath: string
        try {
          decodedPath = decodeURIComponent(requestPath)
        } catch {
          res.statusCode = 400
          res.end('Invalid asset path')
          return
        }

        const filePath = normalize(join(openreelDist, decodedPath.replace(/^\/+/, '')))
        const relativePath = relative(openreelDist, filePath)
        if (relativePath === '..' || relativePath.startsWith('..' + path.sep) || !existsSync(filePath) || !statSync(filePath).isFile()) {
          next()
          return
        }

        res.statusCode = 200
        res.setHeader('Content-Type', contentTypes[extname(filePath).toLowerCase()] ?? 'application/octet-stream')
        createReadStream(filePath).on('error', () => {
          if (!res.writableEnded) {
            res.statusCode = 500
            res.end('Unable to read asset')
          }
        }).pipe(res)
      })
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
    copyOpenReelAssets(),
    serveOpenReelAssets(),
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
