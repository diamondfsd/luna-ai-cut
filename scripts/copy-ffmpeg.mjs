/**
 * 构建时脚本：将 ffmpeg-static 和 ffprobe-static 的二进制复制到 resources/ffmpeg/
 * 由 electron-builder 通过 extraResources 打包进应用
 */
import { copyFileSync, existsSync, mkdirSync, chmodSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const ext = process.platform === 'win32' ? '.exe' : ''
const destDir = join(process.cwd(), 'resources', 'ffmpeg')
mkdirSync(destDir, { recursive: true })

// === ffmpeg ===
try {
  const resolved = require.resolve('ffmpeg-static')
  let src = require('ffmpeg-static')
  if (!src || typeof src !== 'string') src = resolved
  if (src && typeof src === 'string') {
    const dest = join(destDir, `ffmpeg${ext}`)
    copyFileSync(src, dest)
    if (process.platform !== 'win32') chmodSync(dest, 0o755)
    console.log(`[copy-ffmpeg] ✓ ffmpeg → ${dest}`)
  }
} catch {
  console.error('[copy-ffmpeg] ffmpeg-static not found, skipping ffmpeg')
}

// === ffprobe ===
try {
  const pkgDir = dirname(require.resolve('ffprobe-static/package.json'))
  const src = join(pkgDir, 'bin', process.platform, process.arch, `ffprobe${ext}`)
  if (existsSync(src)) {
    const dest = join(destDir, `ffprobe${ext}`)
    copyFileSync(src, dest)
    if (process.platform !== 'win32') chmodSync(dest, 0o755)
    console.log(`[copy-ffmpeg] ✓ ffprobe → ${dest}`)
  } else {
    console.warn(`[copy-ffmpeg] ffprobe not found at ${src}`)
  }
} catch {
  console.warn('[copy-ffmpeg] ffprobe-static not found, skipping ffprobe')
}
