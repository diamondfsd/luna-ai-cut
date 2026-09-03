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
import { copyFileSync, existsSync, mkdirSync, chmodSync, createWriteStream, statSync, rmSync, renameSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { createRequire } from 'node:module'
import https from 'node:https'
import http from 'node:http'
import { createGunzip } from 'node:zlib'
import { pipeline } from 'node:stream/promises'
import { buildDependencyUrl } from './build-dependency-sources.mjs'

const require = createRequire(import.meta.url)
const { path7za } = require('7zip-bin')

// ─── 代理配置（从环境变量读取，加速构建依赖下载） ─────

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

function loadGitCodeToken() {
  if (process.env.GITCODE_TOKEN) return process.env.GITCODE_TOKEN

  let directory = process.cwd()
  for (let depth = 0; depth < 4; depth += 1) {
    const configPath = join(directory, 'scripts', 'deploy-release.conf')
    if (existsSync(configPath)) {
      for (const line of readFileSync(configPath, 'utf8').split(/\r?\n/)) {
        const match = line.match(/^\s*(?:export\s+)?GITCODE_TOKEN=(.*)$/)
        if (!match) continue
        let value = match[1].trim()
        if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
          value = value.slice(1, -1)
        }
        return value
      }
      return null
    }
    const parent = dirname(directory)
    if (parent === directory) break
    directory = parent
  }
  return null
}

const gitCodeToken = loadGitCodeToken()

function requestHeaders(url) {
  if (!gitCodeToken) return undefined
  try {
    const hostname = new URL(url).hostname
    if (hostname === 'gitcode.com' || hostname.endsWith('.gitcode.com')) {
      return { 'PRIVATE-TOKEN': gitCodeToken }
    }
  } catch {
    // Let the request report malformed URLs without leaking credentials.
  }
  return undefined
}

// ─── 解析目标平台/架构参数 ────────────────────────

const targetIndex = process.argv.indexOf('--target')
const targetPlatform = targetIndex !== -1 ? process.argv[targetIndex + 1] : process.platform
const archIndex = process.argv.indexOf('--arch')
const targetArch = archIndex !== -1 ? process.argv[archIndex + 1] : process.arch
const ext = targetPlatform === 'win32' ? '.exe' : ''
const destDir = join(process.cwd(), 'resources', 'ffmpeg')
const cacheDir = join(process.cwd(), '.ffmpeg-cache')
const legacyStaticReleaseTag = 'b6.1.1'
const windowsFfmpegVersion = '8.1.2'
const windowsFfmpegArchiveName = `ffmpeg-${windowsFfmpegVersion}-full_build-shared.7z`
const windowsFfmpegUpstreamUrl = `https://github.com/GyanD/codexffmpeg/releases/download/${windowsFfmpegVersion}/${windowsFfmpegArchiveName}`
const windowsFfmpegCacheKey = `ffmpeg-win32-x64-${windowsFfmpegVersion}-full-shared`
const windowsSharedExtractDir = join(cacheDir, `ffmpeg-${windowsFfmpegVersion}-full_build-shared`)
const windowsFfmpegSha256 = 'cba748035c21ce1431d0823c7a3a711f38616f89f87a265dceddf9b7f6749d2d'
const darwinArm64FfprobeSha256 = 'bb2db6f5d8cef919da12fbf592119a987202a8c060a886f3cab091f9cab90b64'
let windowsBundlePromise = null

console.log(`[copy-ffmpeg] target: ${targetPlatform}-${targetArch}, build: ${process.platform}-${process.arch}`)

mkdirSync(destDir, { recursive: true })
mkdirSync(cacheDir, { recursive: true })

// ─── 下载文件（自动跟随重定向） ─────────────────────

function httpGet(url) {
  const mod = url.startsWith('https:') ? https : http
  const headers = requestHeaders(url)
  return new Promise((resolve, reject) => {
    mod.get(url, headers ? { agent: proxyAgent, headers } : { agent: proxyAgent }, (res) => resolve(res)).on('error', reject)
  })
}

async function downloadFile(url, dest, { gzip = false, maxRedirects = 5 } = {}) {
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
    await pipeline(gzip ? res.pipe(createGunzip()) : res, createWriteStream(dest))
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
  await downloadFile(url, dest, { gzip: true })
}

async function downloadWindowsArchive(dest) {
  const mirrorUrl = buildDependencyUrl(windowsFfmpegArchiveName, windowsFfmpegUpstreamUrl)
  const urls = mirrorUrl === windowsFfmpegUpstreamUrl
    ? [windowsFfmpegUpstreamUrl]
    : [mirrorUrl, windowsFfmpegUpstreamUrl]
  let lastError = null

  for (const url of urls) {
    try {
      console.log(`[copy-ffmpeg] Downloading Windows FFmpeg ${windowsFfmpegVersion} from ${url} ...`)
      await downloadFile(url, dest)
      return
    } catch (error) {
      lastError = error
      console.warn(`[copy-ffmpeg] Windows FFmpeg download failed from ${url}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  throw lastError ?? new Error('Windows FFmpeg archive download failed')
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

function verifyD3d12Encoders(filePath) {
  const result = spawnSync(filePath, ['-hide_banner', '-encoders'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 15_000,
  })
  if (result.error) throw new Error(`FFmpeg encoder probe failed: ${result.error.message}`)
  if (result.status !== 0) throw new Error(`FFmpeg encoder probe exited with status ${result.status ?? 'unknown'}`)

  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`
  const missing = ['h264_d3d12va', 'hevc_d3d12va'].filter((encoder) => !output.includes(encoder))
  if (missing.length > 0) {
    throw new Error(`FFmpeg ${windowsFfmpegVersion} is missing D3D12VA encoder(s): ${missing.join(', ')}`)
  }
}

function findExtractedFile(root, fileName) {
  if (!existsSync(root)) return null
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const entryPath = join(root, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === fileName.toLowerCase()) return entryPath
    if (entry.isDirectory()) {
      const match = findExtractedFile(entryPath, fileName)
      if (match) return match
    }
  }
  return null
}

function extractWindowsArchive(archivePath, destination) {
  const result = spawnSync(path7za, ['x', archivePath, `-o${destination}`, '-y'], {
    encoding: 'utf8',
    windowsHide: true,
    timeout: 120_000,
  })
  if (result.error) throw new Error(`Windows FFmpeg archive extraction failed: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`Windows FFmpeg archive extraction failed: ${(result.stderr || result.stdout || '').trim()}`)
  }
}

async function prepareWindowsBundle() {
  if (targetPlatform !== 'win32' || targetArch !== 'x64') return null
  if (!windowsBundlePromise) {
    windowsBundlePromise = (async () => {
      const ffmpegCachePath = join(cacheDir, windowsFfmpegCacheKey)
      const ffprobeCachePath = join(cacheDir, `${windowsFfmpegCacheKey}-ffprobe`)

      let extractedFfmpeg = findExtractedFile(windowsSharedExtractDir, 'ffmpeg.exe')
      let extractedFfprobe = findExtractedFile(windowsSharedExtractDir, 'ffprobe.exe')
      let extractedAvcodec = findExtractedFile(windowsSharedExtractDir, 'avcodec.lib')

      if (!extractedFfmpeg || !extractedFfprobe || !extractedAvcodec) {
        const localBinDir = process.env.LUNA_FFMPEG_8_1_2_BIN_DIR
        const localFfmpegPath = localBinDir ? join(localBinDir, 'ffmpeg.exe') : null
        const localFfprobePath = localBinDir ? join(localBinDir, 'ffprobe.exe') : null

        if (localFfmpegPath && localFfprobePath && existsSync(localFfmpegPath) && existsSync(localFfprobePath)) {
          const localRoot = dirname(localBinDir)
          if (!existsSync(join(localRoot, 'include', 'libavcodec', 'avcodec.h')) || !existsSync(join(localRoot, 'lib', 'avcodec.lib'))) {
            throw new Error(`LUNA_FFMPEG_8_1_2_BIN_DIR must point to the bin directory of the full shared build`)
          }
          extractedFfmpeg = localFfmpegPath
          extractedFfprobe = localFfprobePath
          extractedAvcodec = join(localRoot, 'lib', 'avcodec.lib')
        } else {
          const archivePath = join(cacheDir, windowsFfmpegArchiveName)
          if (!existsSync(archivePath)) {
            const tmpPath = `${archivePath}.tmp`
            try {
              rmSync(tmpPath, { force: true })
              const localArchive = process.env.LUNA_FFMPEG_8_1_2_ARCHIVE
              if (localArchive) {
                if (!existsSync(localArchive)) throw new Error(`local archive not found: ${localArchive}`)
                copyFileSync(localArchive, tmpPath)
              } else {
                await downloadWindowsArchive(tmpPath)
              }
              renameSync(tmpPath, archivePath)
            } catch (error) {
              rmSync(tmpPath, { force: true })
              throw error
            }
          }
          verifySha256(archivePath, windowsFfmpegSha256, 'Windows FFmpeg archive')

          rmSync(windowsSharedExtractDir, { recursive: true, force: true })
          mkdirSync(windowsSharedExtractDir, { recursive: true })
          extractWindowsArchive(archivePath, windowsSharedExtractDir)

          extractedFfmpeg = findExtractedFile(windowsSharedExtractDir, 'ffmpeg.exe')
          extractedFfprobe = findExtractedFile(windowsSharedExtractDir, 'ffprobe.exe')
          extractedAvcodec = findExtractedFile(windowsSharedExtractDir, 'avcodec.lib')
          if (!extractedFfmpeg || !extractedFfprobe || !extractedAvcodec) {
            throw new Error(`Windows FFmpeg ${windowsFfmpegVersion} shared archive is incomplete`)
          }
        }
      }

      copyFileSync(extractedFfmpeg, ffmpegCachePath)
      copyFileSync(extractedFfprobe, ffprobeCachePath)
      const binDir = dirname(extractedFfmpeg)
      const sharedRoot = dirname(binDir)

      return { ffmpegPath: ffmpegCachePath, ffprobePath: ffprobeCachePath, binDir, sharedRoot }
    })()
  }
  return windowsBundlePromise
}

function copyWindowsSharedRuntime(bundle) {
  for (const fileName of readdirSync(bundle.binDir)) {
    if (!/^(?:av|sw).+\.dll$/i.test(fileName)) continue
    copyFileIfChanged(join(bundle.binDir, fileName), join(destDir, fileName))
  }
  const license = join(bundle.sharedRoot, 'LICENSE')
  if (existsSync(license)) copyFileIfChanged(license, join(destDir, 'FFmpeg-LICENSE.txt'))
}

function copyFileIfChanged(source, destination) {
  if (existsSync(destination)) {
    const sourceStat = statSync(source)
    const destinationStat = statSync(destination)
    if (sourceStat.size === destinationStat.size) {
      const sourceHash = createHash('sha256').update(readFileSync(source)).digest('hex')
      const destinationHash = createHash('sha256').update(readFileSync(destination)).digest('hex')
      if (sourceHash === destinationHash) return
    }
  }

  try {
    copyFileSync(source, destination)
  } catch (error) {
    if (error?.code === 'EBUSY' || error?.code === 'EPERM') {
      throw new Error(`Cannot update ${destination} because it is in use. Close the running app and retry.`, { cause: error })
    }
    throw error
  }
}

// ─── ffmpeg ────────────────────────────────────

async function copyFfmpeg() {
  const dest = join(destDir, `ffmpeg${ext}`)

  if (targetPlatform === 'win32' && targetArch === 'x64') {
    const bundle = await prepareWindowsBundle()
    copyWindowsSharedRuntime(bundle)
    copyFileIfChanged(bundle.ffmpegPath, dest)
    if (targetPlatform === process.platform && targetArch === process.arch) {
      verifyExecutable(dest, 'ffmpeg')
      verifyD3d12Encoders(dest)
    }
    console.log(`[copy-ffmpeg] ✓ FFmpeg ${windowsFfmpegVersion} shared runtime with D3D12VA encoders → ${dest}`)
    return
  }

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
      await downloadStaticBinary('ffmpeg', legacyStaticReleaseTag, targetPlatform, targetArch, tmpPath)
      renameSync(tmpPath, cachePath)
      if (targetPlatform !== 'win32') chmodSync(cachePath, 0o755)
      console.log(`[copy-ffmpeg] ✓ ffmpeg 已下载到缓存 → ${cachePath}`)
    } catch (err) {
      try { rmSync(tmpPath, { force: true }) } catch { /* ignore */ }
      console.error(`[copy-ffmpeg] ✗ 下载 ffmpeg 失败: ${err.message}`)
      console.error(`  尝试手动下载: https://github.com/eugeneware/ffmpeg-static/releases/tag/${legacyStaticReleaseTag}`)
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
    if (targetPlatform === 'win32' && targetArch === 'x64') {
      const bundle = await prepareWindowsBundle()
      const dest = join(destDir, `ffprobe${ext}`)
      copyWindowsSharedRuntime(bundle)
      copyFileIfChanged(bundle.ffprobePath, dest)
      if (targetPlatform === process.platform && targetArch === process.arch) {
        verifyExecutable(dest, 'ffprobe')
      }
      console.log(`[copy-ffmpeg] ✓ FFprobe ${windowsFfmpegVersion} → ${dest}`)
      return
    }

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
          await downloadStaticBinary('ffprobe', legacyStaticReleaseTag, targetPlatform, targetArch, tmpPath)
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
