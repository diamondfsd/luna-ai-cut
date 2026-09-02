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
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, chmodSync, createWriteStream, statSync, rmSync, renameSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import https from 'node:https'
import http from 'node:http'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { buildDependencyUrl } from './build-dependency-sources.mjs'

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
const staticReleaseTag = 'b6.1.1'
const darwinArm64FfprobeSha256 = 'bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64'

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

async function downloadStaticBinary(name, releaseTag, platform, arch, dest) {
  const fileName = `${name}-${platform}-${arch}.gz`
  const upstreamUrl = `https://github.com/eugeneware/ffmpeg-static/releases/download/${releaseTag}/${fileName}`
  const url = buildDependencyUrl(fileName, upstreamUrl)
  console.log(`[copy-ffmpeg] Downloading ${name} from ${url} ...`)
  await downloadFile(url, dest)
}

function verifySha256(path, expected, label) {
  const actual = createHash('sha256').update(readFileSync(path)).digest('hex')
  if (actual !== expected) {
    throw new Error(`${label} SHA256 校验失败: expected ${expected}, got ${actual}`)
  }
}

function verifyTargetArchitecture(path, label) {
  if (targetPlatform !== 'darwin') return

  const header = readFileSync(path).subarray(0, 8)
  if (header.length < 8 || header.readUInt32LE(0) !== 0xfeedfacf) {
    throw new Error(`${label} 不是受支持的 64 位 Mach-O 文件`)
  }

  const cpuType = header.readUInt32LE(4)
  const expectedCpuType = targetArch === 'arm64' ? 0x0100000c : 0x01000007
  if (cpuType !== expectedCpuType) {
    const actualArch = cpuType === 0x0100000c ? 'arm64' : cpuType === 0x01000007 ? 'x64' : `cpuType=0x${cpuType.toString(16)}`
    throw new Error(`${label} 架构不匹配: expected ${targetArch}, got ${actualArch}`)
  }
  console.log(`[copy-ffmpeg] ✓ ${label} 架构校验通过: ${targetArch}`)
}

function verifyExecutable(filePath, label) {
  const result = spawnSync(filePath, ['-version'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 15_000,
  })
  if (result.error) throw new Error(`${label} failed to start: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`${label} exited with status ${result.status ?? 'unknown'} signal ${result.signal ?? 'none'}`)
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
        verifyTargetArchitecture(dest, 'ffmpeg')
        verifyExecutable(dest, 'ffmpeg')
        console.log(`[copy-ffmpeg] ✓ ffmpeg → ${dest}`)
        return
      }
    } catch (error) {
      console.warn(`[copy-ffmpeg] local ffmpeg-static is unusable; downloading from GitCode: ${error instanceof Error ? error.message : String(error)}`)
      console.warn('[copy-ffmpeg] ffmpeg-static not found locally, will download')
    }
  }

  // 交叉编译：使用独立缓存目录，避免每次构建重新下载
  const cacheKey = `ffmpeg-${targetPlatform}-${targetArch}`
  const cachePath = join(cacheDir, cacheKey)

  if (!existsSync(cachePath)) {
    const tmpPath = cachePath + '.tmp'
    try {
      // 先清空可能残留的临时文件，下载到 .tmp，完成后再改名，避免断下载导致缓存不全
      try { rmSync(tmpPath, { force: true }) } catch { /* ignore */ }
      await downloadStaticBinary('ffmpeg', staticReleaseTag, targetPlatform, targetArch, tmpPath)
      renameSync(tmpPath, cachePath)
      if (targetPlatform !== 'win32') chmodSync(cachePath, 0o755)
      console.log(`[copy-ffmpeg] ✓ ffmpeg 已下载到缓存 → ${cachePath}`)
    } catch (err) {
      try { rmSync(tmpPath, { force: true }) } catch { /* ignore */ }
      console.error(`[copy-ffmpeg] ✗ 下载 ffmpeg 失败: ${err.message}`)
      console.error(`  尝试手动下载: https://github.com/eugeneware/ffmpeg-static/releases/tag/${staticReleaseTag}`)
      process.exit(1)
    }
  } else {
    const size = (statSync(cachePath).size / 1024 / 1024).toFixed(1)
    console.log(`[copy-ffmpeg] ✓ ffmpeg 命中缓存 → ${cachePath} (${size} MB)`)
  }

  // 从缓存复制到构建目录
  copyFileSync(cachePath, dest)
  if (targetPlatform !== 'win32') chmodSync(dest, 0o755)
  verifyTargetArchitecture(dest, 'ffmpeg')
  if (targetPlatform === process.platform && targetArch === process.arch) verifyExecutable(dest, 'ffmpeg')
  console.log(`[copy-ffmpeg] ✓ ffmpeg → ${dest}`)
}

// ─── ffprobe ─────

async function copyFfprobe() {
  try {
    const pkgDir = dirname(require.resolve('ffprobe-static/package.json'))
    let src = join(pkgDir, 'bin', targetPlatform, targetArch, `ffprobe${ext}`)

    // ffprobe-static@3.1.0 的 darwin/arm64 文件实际是 x86_64，改用同一固定
    // ffmpeg-static release 中经过校验的原生二进制。
    if (targetPlatform === 'darwin' && targetArch === 'arm64') {
      src = join(cacheDir, 'ffprobe-darwin-arm64')
      if (!existsSync(src)) {
        const tmpPath = src + '.tmp'
        try {
          rmSync(tmpPath, { force: true })
          await downloadStaticBinary('ffprobe', staticReleaseTag, targetPlatform, targetArch, tmpPath)
          verifySha256(tmpPath, darwinArm64FfprobeSha256, 'ffprobe')
          renameSync(tmpPath, src)
        } catch (err) {
          rmSync(tmpPath, { force: true })
          throw err
        }
      }
      verifySha256(src, darwinArm64FfprobeSha256, 'ffprobe')
    }

    if (!existsSync(src)) throw new Error(`ffprobe not found at ${src}`)

    const dest = join(destDir, `ffprobe${ext}`)
    copyFileSync(src, dest)
    if (targetPlatform !== 'win32') chmodSync(dest, 0o755)
    verifyTargetArchitecture(dest, 'ffprobe')
    console.log(`[copy-ffmpeg] ✓ ffprobe → ${dest}`)
  } catch (err) {
    console.error('[copy-ffmpeg] ✗ ffprobe 准备失败', err)
    process.exit(1)
  }
}

// ─── 执行 ──────────────────────────────────────

await copyFfprobe()
await copyFfmpeg()
