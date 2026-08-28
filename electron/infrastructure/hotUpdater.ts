/**
 * hotUpdater.ts — 热更新服务
 *
 * 从 GitCode Release 的附件中检查并应用渲染层 + 主进程的 JS 热更新。
 * 热更新 zip 包上传到与当前版本同 tag 的 Release 上。
 *
 * 目录结构（userData/.luna-hot/）：
 *   version.json     ← { "version": "1.3.1-hot.1" }
 *   dist-electron/
 *     luna-appMain.js  ← 热更新的主进程
 *     preload.mjs      ← 热更新的 preload
 *   dist/
 *     index.html       ← 热更新的渲染层
 *     assets/*         ← 热更新的 JS/CSS
 */

import { app } from 'electron'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import {
  canLoadHotUpdate,
  compareHotUpdateVersions,
  releaseChannelForBuild,
} from '../../src/shared/hotUpdateCompatibility'
import { isTestBuild } from '../../src/shared/buildChannel'
import { installHotUpdateArchive, type HotUpdateIntegrity } from './hotUpdateArchiveService'
import { logMainInfo, logMainWarn } from './loggerService'

// ── 常量 ──

const HOT_DIR = () => join(app.getPath('userData'), '.luna-hot')
const VERSION_FILE = () => join(HOT_DIR(), 'version.json')
const HOT_APP_FILES = [
  'dist-electron/luna-appMain.js',
  'dist-electron/preload.mjs',
  'dist/index.html',
]

const GITCODE_API = 'https://api.gitcode.com/api/v5/repos/diamondfsd/luna-ai-cut-package-release'
const GITCODE_DL = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download'
let activeHotUpdate: Promise<void> | null = null

function currentPlatformPackage(): string {
  if (process.platform === 'darwin') {
    return process.arch === 'x64' ? 'darwin-x64' : 'darwin-arm64'
  }
  if (process.platform === 'win32') return 'win32-x64'
  return `${process.platform}-${process.arch}`
}

// ── 类型 ──

/** 从 GitCode Release 附件解析出的热更新信息。 */
export interface HotUpdateManifest {
  version: string
  zipName: string
  minAppVersion: string
  integrity?: HotUpdateIntegrity
  notesUrl?: string
}

/** 热更新检查结果 */
export interface HotUpdateCheckResult {
  version: string
  downloadUrl: string
  manifest: HotUpdateManifest
  notes?: string
}

// ── 本地版本读写 ──

/** 获取当前安装的热更新版本号，没有则返回 null */
export function getCurrentHotVersion(): string | null {
  try {
    const path = VERSION_FILE()
    if (!existsSync(path)) {
      return null
    }
    const data = JSON.parse(readFileSync(path, 'utf-8'))
    const version = typeof data.version === 'string' ? data.version : null
    if (!version) return null
    if (!HOT_APP_FILES.every((file) => existsSync(join(HOT_DIR(), file)))) {
      logMainWarn('[hot-update] 本地热更新内容不完整，将重新下载')
      return null
    }
    return version
  } catch (err) {
    logMainWarn('[hot-update] 读取本地版本失败', { error: err instanceof Error ? err.message : String(err) })
    return null
  }
}

// ── GitCode API ──

/**
 * 通过 GitCode API 获取 Release 附件列表中最新的热更新 zip
 *
 * 不依赖静态 manifest 文件（OBS 不允许覆盖上传），
 * 直接从 API 返回的附件中按版本号排序取最新。
 */
async function fetchLatestHotUpdateViaAPI(releaseTag: string): Promise<HotUpdateManifest | null> {
  try {
    const res = await fetch(`${GITCODE_API}/releases/tags/${encodeURIComponent(releaseTag)}`)
    if (!res.ok) return null

    const data = await res.json() as { assets?: Array<{ name: string; browser_download_url?: string }> }
    const assets = data.assets ?? []

    const platform = currentPlatformPackage()
    const hotVersionPattern = '(\\d+\\.\\d+\\.\\d+(?:-beta\\.\\d+)?-hot\\.\\d+)'
    const platformPattern = new RegExp(`^renderer-${hotVersionPattern}-${platform}\\.zip$`)
    const universalPattern = new RegExp(`^renderer-${hotVersionPattern}\\.zip$`)
    const hotZips = assets.flatMap((asset) => {
      const platformMatch = asset.name.match(platformPattern)
      if (platformMatch) return [{ ...asset, version: platformMatch[1], platformSpecific: true }]

      const universalMatch = asset.name.match(universalPattern)
      if (universalMatch) return [{ ...asset, version: universalMatch[1], platformSpecific: false }]

      return []
    })

    if (hotZips.length === 0) return null

    // 先选择最新版本；同一版本同时存在两种包时，再优先当前平台包。
    hotZips.sort((a, b) => {
      const versionOrder = compareHotUpdateVersions(b.version, a.version)
      if (versionOrder !== 0) return versionOrder
      return Number(b.platformSpecific) - Number(a.platformSpecific)
    })

    const latest = hotZips[0]
    const version = latest.version

    const integrity = await fetchHotUpdateIntegrity(releaseTag, version, latest.name, assets)

    // 查找对应的发布说明文件
    const notesAsset = assets.find(a =>
      a.name === `RELEASE_NOTES_v${version}.md`
    )

    return {
      version,
      zipName: latest.name,
      minAppVersion: releaseTag.replace(/^test\//, '').replace(/^beta\//, '').replace(/^v/, ''),
      integrity,
      notesUrl: notesAsset ? `${GITCODE_DL}/${releaseTag}/${notesAsset.name}` : undefined,
    }
  } catch (error) {
    logMainWarn('[hot-update] 查询 GitCode Release 失败', {
      releaseTag,
      error: error instanceof Error ? error.message : String(error),
    })
    return null
  }
}

async function fetchHotUpdateIntegrity(
  releaseTag: string,
  version: string,
  zipName: string,
  assets: Array<{ name: string }>,
): Promise<HotUpdateIntegrity | undefined> {
  const manifestName = `renderer-${version}.json`
  if (!assets.some((asset) => asset.name === manifestName)) return undefined
  try {
    const response = await fetch(`${GITCODE_DL}/${releaseTag}/${manifestName}`)
    if (!response.ok) return undefined
    const manifest = await response.json() as {
      version?: unknown
      packages?: Record<string, { zipName?: unknown; sha256?: unknown; sizeBytes?: unknown }>
    }
    if (manifest.version !== version) return undefined
    const entry = Object.values(manifest.packages ?? {}).find((candidate) => candidate.zipName === zipName)
    if (!entry || typeof entry.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(entry.sha256)) return undefined
    if (typeof entry.sizeBytes !== 'number' || !Number.isInteger(entry.sizeBytes) || entry.sizeBytes <= 0) return undefined
    return { sha256: entry.sha256, sizeBytes: entry.sizeBytes }
  } catch (error) {
    logMainWarn('[hot-update] 读取完整性清单失败', {
      releaseTag,
      version,
      zipName,
      error: error instanceof Error ? error.message : String(error),
    })
    return undefined
  }
}

// ── 核心检查逻辑 ──

/**
 * 检查是否有可用的热更新
 * 返回 null 表示没有新版本
 */
export async function checkForHotUpdates(): Promise<HotUpdateCheckResult | null> {
  // 开发模式跳过热更新检查，避免本地开发时弹通知
  if (!app.isPackaged) {
    logMainInfo('[hot-update] 开发模式跳过检查')
    return null
  }

  const appVersion = app.getVersion()
  const appRelease = releaseChannelForBuild(appVersion, isTestBuild ? 'test' : 'stable')
  if (!appRelease) {
    logMainWarn('[hot-update] 当前安装包版本不在支持的更新通道中', { appVersion })
    return null
  }
  const releaseTag = appRelease.releaseTag
  logMainInfo('[hot-update] 开始检查', {
    appVersion: appRelease.version,
    channel: appRelease.channel,
    releaseTag,
  })

  const manifest = await fetchLatestHotUpdateViaAPI(releaseTag)
  if (!manifest) {
    logMainInfo('[hot-update] 没有找到可用热更新', { releaseTag })
    return null
  }

  // 检查 minAppVersion 约束
  const minAppRelease = releaseChannelForBuild(manifest.minAppVersion, appRelease.buildChannel)
  if (!minAppRelease || minAppRelease.version !== appRelease.version) {
    logMainWarn('[hot-update] 热更新最低版本不匹配', {
      appVersion: appRelease.version,
      minAppVersion: manifest.minAppVersion,
      hotVersion: manifest.version,
    })
    return null
  }

  // 检查版本是否匹配当前 app 版本
  if (!canLoadHotUpdate(appVersion, manifest.version)) {
    return null
  }

  // 与本地热更新版本比较
  const localVersion = getCurrentHotVersion()
  if (localVersion && compareHotUpdateVersions(manifest.version, localVersion) <= 0) {
    logMainInfo('[hot-update] 本地热更新已是最新', { localVersion, remoteVersion: manifest.version })
    return null
  }

  const downloadUrl = `${GITCODE_DL}/${releaseTag}/${manifest.zipName}`

  // 获取发布说明
  let notes: string | undefined
  if (manifest.notesUrl) {
    try {
      const notesRes = await fetch(manifest.notesUrl)
      if (notesRes.ok) {
        const text = await notesRes.text()
        // 只取前 2048 个字符作为摘要
        notes = text.length > 2048 ? text.slice(0, 2048) + '\n...' : text
      }
    } catch { /* 获取发布说明失败不影响热更新 */ }
  }

  logMainInfo('[hot-update] 发现可用热更新', {
    channel: appRelease.channel,
    releaseTag,
    version: manifest.version,
    zipName: manifest.zipName,
    hasIntegrity: Boolean(manifest.integrity),
  })
  return { version: manifest.version, downloadUrl, manifest, notes }
}

// ── 下载与应用 ──

/**
 * 下载热更新 zip 包并应用到 userData/.luna-hot/ 目录
 */
export function applyHotUpdate(info: HotUpdateCheckResult): Promise<void> {
  if (activeHotUpdate) return activeHotUpdate
  activeHotUpdate = applyHotUpdateOnce(info).finally(() => { activeHotUpdate = null })
  return activeHotUpdate
}

async function applyHotUpdateOnce(info: HotUpdateCheckResult): Promise<void> {
  if (!canLoadHotUpdate(app.getVersion(), info.version)) {
    throw new Error('此热更新与当前安装版本不匹配')
  }
  logMainInfo('[hot-update] 开始下载并安装', {
    appVersion: app.getVersion(),
    version: info.version,
    zipName: info.manifest.zipName,
    sizeBytes: info.manifest.integrity?.sizeBytes,
    hasIntegrity: Boolean(info.manifest.integrity),
  })
  await installHotUpdateArchive(HOT_DIR(), {
    version: info.version,
    zipName: info.manifest.zipName,
    downloadUrl: info.downloadUrl,
    integrity: info.manifest.integrity,
  })
}

/** 清理热更新，恢复到 asar 内置版本 */
export function clearHotUpdate(): void {
  const hotDir = HOT_DIR()
  rmSync(hotDir, { recursive: true, force: true })
  logMainInfo('[hot-update] 已清理本地热更新')
}

/**
 * 获取热更新目录文件列表（用于调试）
 */
export function getHotUpdateFileList(): string[] {
  const hotDir = HOT_DIR()
  const result: string[] = []

  function walk(dir: string, prefix: string): void {
    if (!existsSync(dir)) return
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name)
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      if (entry.isDirectory()) {
        walk(fullPath, relativePath)
      } else {
        result.push(relativePath)
      }
    }
  }

  walk(hotDir, '')
  return result
}
