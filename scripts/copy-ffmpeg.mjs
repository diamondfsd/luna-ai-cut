/**
 * 构建时脚本：将 ffmpeg 和 ffprobe 二进制复制到 resources/ffmpeg/
 * 由 electron-builder 通过 extraResources 打包进应用。
 *
 * 支持交叉编译：
 *   --target <darwin|win32|linux>  目标平台（默认：当前平台）
 *   --arch <x64|arm64>             目标架构（默认：当前架构）
 *
 * 示例：
 *   node scripts/copy-ffmpeg.mjs --target win32          # 为 Windows x64 准备
 *   node scripts/copy-ffmpeg.mjs --target darwin --arch arm64  # 为 macOS arm64 准备
 */
import { copyFileSync, existsSync, mkdirSync, chmodSync, createWriteStream, statSync, rmSync, renameSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import https from 'node:https'
import http from 'node:http'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'

const require = createRequire(import.meta.url)

// ─── 代理配置（从环境变量读取，加速 GitHub 访问） ─────

const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy || ''
let proxyAgent = null
if (proxyUrl) {
  try {
    const { HttpsProxyAgent } = require('https-proxy-agent')
    proxyAgent = new HttpsProxyAgent(proxyUrl)
    console.log(`[copy-ffmpeg] 使用代理: ${proxyUrl}`)
  } catch {
    console.warn('[copy-ffmpeg] https-proxy-agent 不可用，将直连下载')
  }
}

// ─── 解析目标平台/架构参数 ────────────────────────

const targetIndex = process.argv.indexOf('--target')
const targetPlatform = targetIndex !== -1 ? process.argv[targetIndex + 1] : process.platform
const archIndex = process.argv.indexOf('--arch')
const targetArch = archIndex !== -1 ? process.argv[archIndex + 1] : process.arch
const ext = targetPlatform === 'win32' ? '.exe' : ''
const destDir = join(process.cwd(), 'resources', 'ffmpeg')
const cacheDir = join(process.cwd(), '.ffmpeg-cache')

console.log(`[copy-ffmpeg] target: ${targetPlatform}-${targetArch}, build: ${process.platform}-${process.arch}`)

mkdirSync(destDir, { recursive: true })
mkdirSync(cacheDir, { recursive: true })

// ─── 下载文件（自动跟随重定向） ─────────────────────

function httpGet(url) {
  const mod = url.startsWith('https:') ? https : http
  return new Promise((resolve, reject) => {
    mod.get(url, { agent: proxyAgent }, (res) => resolve(res)).on('error', reject)
  })
}

async function downloadFile(url, dest, maxRedirects = 5) {
  let currentUrl = url
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await httpGet(currentUrl)
    if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      res.resume() // 消耗响应体以释放连接
      currentUrl = new URL(res.headers.location, currentUrl).href
      continue
    }
    if (res.statusCode !== 200) {
      res.resume()
      throw new Error(`HTTP ${res.statusCode}`)
    }
    await pipeline(res, createGunzip(), createWriteStream(dest))
    return
  }
  throw new Error(`Too many redirects (${maxRedirects})`)
}

// ─── 从 GitHub Releases 下载 ffmpeg（交叉编译时使用） ───

async function downloadFfmpeg(releaseTag, platform, arch, dest) {
  const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${releaseTag}/ffmpeg-${platform}-${arch}.gz`
  console.log(`[copy-ffmpeg] Downloading ffmpeg from ${url} ...`)
  await downloadFile(url, dest)
}

// ─── ffmpeg ────────────────────────────────────

async function copyFfmpeg() {
  const dest = join(destDir, `ffmpeg${ext}`)

  if (targetPlatform === process.platform && targetArch === process.arch) {
    // 同平台同架构：从 ffmpeg-static 复制（npm install 时已下载好的）
    try {
      const resolved = require.resolve('ffmpeg-static')
      let src = require('ffmpeg-static')
      if (!src || typeof src !== 'string') src = resolved
      if (src && typeof src === 'string') {
        copyFileSync(src, dest)
        if (targetPlatform !== 'win32') chmodSync(dest, 0o755)
        console.log(`[copy-ffmpeg] ✓ ffmpeg → ${dest}`)
        return
      }
    } catch {
      console.warn('[copy-ffmpeg] ffmpeg-static not found locally, will download')
    }
  }

  // 交叉编译：使用独立缓存目录，避免每次构建重新下载
  const cacheKey = `ffmpeg-${targetPlatform}-${targetArch}`
  const cachePath = join(cacheDir, cacheKey)

  if (!existsSync(cachePath)) {
    const releaseTag = 'b6.1.1' // 对应 ffmpeg-static@5.3.0 的 binary-release-tag
    const tmpPath = cachePath + '.tmp'
    try {
      // 先清空可能残留的临时文件，下载到 .tmp，完成后再改名，避免断下载导致缓存不全
      try { rmSync(tmpPath, { force: true }) } catch { /* ignore */ }
      await downloadFfmpeg(releaseTag, targetPlatform, targetArch, tmpPath)
      renameSync(tmpPath, cachePath)
      if (targetPlatform !== 'win32') chmodSync(cachePath, 0o755)
      console.log(`[copy-ffmpeg] ✓ ffmpeg 已下载到缓存 → ${cachePath}`)
    } catch (err) {
      try { rmSync(tmpPath, { force: true }) } catch { /* ignore */ }
      console.error(`[copy-ffmpeg] ✗ 下载 ffmpeg 失败: ${err.message}`)
      console.error(`  尝试手动下载: https://github.com/eugeneware/ffmpeg-static/releases/tag/${releaseTag}`)
      process.exit(1)
    }
  } else {
    const size = (statSync(cachePath).size / 1024 / 1024).toFixed(1)
    console.log(`[copy-ffmpeg] ✓ ffmpeg 命中缓存 → ${cachePath} (${size} MB)`)
  }

  // 从缓存复制到构建目录
  copyFileSync(cachePath, dest)
  if (targetPlatform !== 'win32') chmodSync(dest, 0o755)
  console.log(`[copy-ffmpeg] ✓ ffmpeg → ${dest}`)
}

// ─── ffprobe（ffprobe-static 已内置多平台二进制） ─────

function copyFfprobe() {
  try {
    const pkgDir = dirname(require.resolve('ffprobe-static/package.json'))
    const src = join(pkgDir, 'bin', targetPlatform, targetArch, `ffprobe${ext}`)
    if (existsSync(src)) {
      const dest = join(destDir, `ffprobe${ext}`)
      copyFileSync(src, dest)
      if (targetPlatform !== 'win32') chmodSync(dest, 0o755)
      console.log(`[copy-ffmpeg] ✓ ffprobe → ${dest}`)
    } else {
      // 降级：使用当前平台的 ffprobe
      const fallbackSrc = join(pkgDir, 'bin', process.platform, process.arch, `ffprobe${process.platform === 'win32' ? '.exe' : ''}`)
      if (existsSync(fallbackSrc)) {
        const dest = join(destDir, `ffprobe${ext}`)
        copyFileSync(fallbackSrc, dest)
        if (targetPlatform !== 'win32') chmodSync(dest, 0o755)
        console.warn(`[copy-ffmpeg] ⚠ ffprobe 无 ${targetPlatform}-${targetArch} 版本，使用 ${process.platform}-${process.arch} 代替 → ${dest}`)
      } else {
        console.warn(`[copy-ffmpeg] ✗ ffprobe not found at ${src} (fallback also missing)`)
      }
    }
  } catch {
    console.warn('[copy-ffmpeg] ffprobe-static not found, skipping ffprobe')
  }
}

// ─── 执行 ──────────────────────────────────────

copyFfprobe()
await copyFfmpeg()
