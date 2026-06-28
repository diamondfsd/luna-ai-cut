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
import { cpSync, createWriteStream, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import AdmZip from 'adm-zip'

// ── 常量 ──

const HOT_DIR = () => join(app.getPath('userData'), '.luna-hot')
const VERSION_FILE = () => join(HOT_DIR(), 'version.json')

const GITCODE_API = 'https://api.gitcode.com/api/v5/repos/diamondfsd/luna-ai-cut-package-release'
const GITCODE_DL = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download'

// ── 类型 ──

/** renderer-latest.json 清单结构 */
export interface HotUpdateManifest {
  version: string
  zipName: string
  minAppVersion: string
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
    return version
  } catch (err) {
    console.log(`[hot-update] getCurrentHotVersion: 读取失败`, err)
    return null
  }
}

/** 写入热更新版本号 */
function writeCurrentHotVersion(version: string): void {
  mkdirSync(HOT_DIR(), { recursive: true })
  writeFileSync(VERSION_FILE(), JSON.stringify({ version, updatedAt: new Date().toISOString() }), 'utf-8')
}

// ── 版本比较 ──

/**
 * 比较两个版本号（如 "1.3.1-hot.2"）
 * 返回 1 (a > b) / 0 (a === b) / -1 (a < b)
 */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split(/[-.]/).filter(Boolean)
  const pb = b.replace(/^v/, '').split(/[-.]/).filter(Boolean)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = Number(pa[i]) || 0
    const nb = Number(pb[i]) || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

/**
 * 解析 hot 版本号，检查基础版本是否匹配当前 app 版本
 * "1.3.1-hot.2" → { appVersion: "1.3.1", hotBuild: 2 }
 */
function parseHotVersion(version: string): { appVersion: string; hotBuild: number } | null {
  const match = version.match(/^(\d+\.\d+\.\d+)-hot\.(\d+)$/)
  if (!match) return null
  return { appVersion: match[1], hotBuild: Number(match[2]) }
}

// ── GitCode API ──

// ── GitCode API ──

/**
 * 通过 GitCode API 获取 Release 附件列表中最新的热更新 zip
 *
 * 不依赖静态 manifest 文件（OBS 不允许覆盖上传），
 * 直接从 API 返回的附件中按版本号排序取最新。
 */
async function fetchLatestHotUpdateViaAPI(releaseTag: string): Promise<HotUpdateManifest | null> {
  try {
    const res = await fetch(`${GITCODE_API}/releases/tags/${releaseTag}`)
    if (!res.ok) return null

    const data = await res.json() as { assets?: Array<{ name: string; browser_download_url?: string }> }
    const assets = data.assets ?? []

    // 筛选 renderer-*-hot.*.zip 附件
    const hotZips = assets.filter(a => {
      return a.name.startsWith('renderer-') &&
             a.name.endsWith('.zip') &&
             /renderer-\d+\.\d+\.\d+-hot\.\d+\.zip$/.test(a.name)
    })

    if (hotZips.length === 0) return null

    // 按 hot build 号降序排列，取最新的
    hotZips.sort((a, b) => {
      const na = Number(a.name.match(/-hot\.(\d+)\.zip$/)?.[1] ?? 0)
      const nb = Number(b.name.match(/-hot\.(\d+)\.zip$/)?.[1] ?? 0)
      return nb - na
    })

    const latest = hotZips[0]
    // "renderer-1.3.1-hot.6.zip" → "1.3.1-hot.6"
    const version = latest.name
      .replace(/^renderer-/, '')
      .replace(/\.zip$/, '')

    // 查找对应的发布说明文件
    const notesAsset = assets.find(a =>
      a.name === `RELEASE_NOTES_v${version}.md`
    )

    return {
      version,
      zipName: latest.name,
      minAppVersion: releaseTag.replace(/^v/, ''),
      notesUrl: notesAsset?.browser_download_url,
    }
  } catch {
    return null
  }
}

// ── 核心检查逻辑 ──

/**
 * 检查是否有可用的热更新
 * 返回 null 表示没有新版本
 */
export async function checkForHotUpdates(): Promise<HotUpdateCheckResult | null> {
  const appVersion = app.getVersion()
  const releaseTag = `v${appVersion}`

  const manifest = await fetchLatestHotUpdateViaAPI(releaseTag)
  if (!manifest) return null

  // 检查 minAppVersion 约束
  if (compareVersions(appVersion, manifest.minAppVersion) < 0) {
    return null
  }

  // 检查版本是否匹配当前 app 版本
  const parsed = parseHotVersion(manifest.version)
  if (!parsed || parsed.appVersion !== appVersion) {
    return null
  }

  // 与本地热更新版本比较
  const localVersion = getCurrentHotVersion()
  if (localVersion && compareVersions(manifest.version, localVersion) <= 0) {
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

  return { version: manifest.version, downloadUrl, manifest, notes }
}

// ── 下载与应用 ──

/**
 * 下载热更新 zip 包并应用到 userData/.luna-hot/ 目录
 */
export async function applyHotUpdate(info: HotUpdateCheckResult): Promise<void> {
  const hotDir = HOT_DIR()
  const downloadTempDir = join(hotDir, '.download-temp')
  const zipPath = join(downloadTempDir, 'hot-update.zip')
  const extractDir = join(downloadTempDir, 'extract')

  // 清理旧的临时目录
  rmSync(downloadTempDir, { recursive: true, force: true })
  mkdirSync(extractDir, { recursive: true })

  // 1. 下载 zip
  const res = await fetch(info.downloadUrl)
  if (!res.ok) {
    throw new Error(`下载热更新失败: HTTP ${res.status}`)
  }

  const fileStream = createWriteStream(zipPath)
  // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
  await pipeline(res.body as any, fileStream)

  // 2. 解压
  const zip = new AdmZip(zipPath)
  zip.extractAllTo(extractDir, true)

  // 3. 验证解压结果包含必要的文件
  const expectedFiles = [
    'dist-electron/luna-appMain.js',
    'dist-electron/preload.mjs',
    'dist/index.html',
  ]
  for (const file of expectedFiles) {
    if (!existsSync(join(extractDir, file))) {
      throw new Error(`热更新包缺少文件: ${file}`)
    }
  }

  // 写入 package.json 标记 ESM，使热更新的 .js 文件能被 import() 正确加载
  writeFileSync(
    join(extractDir, 'package.json'),
    JSON.stringify({ type: 'module', name: 'luna-ai-cut-hot', private: true }),
    'utf-8',
  )

  // 4. 删除旧的热更新文件
  const oldDistElectron = join(hotDir, 'dist-electron')
  const oldDist = join(hotDir, 'dist')
  if (existsSync(oldDistElectron)) {
    rmSync(oldDistElectron, { recursive: true, force: true })
  }
  if (existsSync(oldDist)) {
    rmSync(oldDist, { recursive: true, force: true })
  }

  // 5. 移动新文件
  const extractEntries = readdirSync(extractDir)

  if (extractEntries.includes('dist-electron') && extractEntries.includes('dist')) {
    for (const entry of extractEntries) {
      const src = join(extractDir, entry)
      const dest = join(hotDir, entry)
      copyRecursiveSync(src, dest)
    }
  } else if (extractEntries.length === 1) {
    // 嵌套结构：一个顶层目录，里面包含 dist-electron/ + dist/
    const singleDir = join(extractDir, extractEntries[0])
    if (existsSync(singleDir) && existsSync(join(singleDir, 'dist-electron'))) {
      for (const entry of readdirSync(singleDir)) {
        const src = join(singleDir, entry)
        const dest = join(hotDir, entry)
        copyRecursiveSync(src, dest)
      }
    } else {
      throw new Error('热更新包目录结构异常')
    }
  } else {
    throw new Error('热更新包目录结构异常')
  }

  // 6. 写入版本信息
  writeCurrentHotVersion(info.version)

  // 7. 清理临时文件
  rmSync(downloadTempDir, { recursive: true, force: true })
}

// ── 辅助函数 ──

/** 递归复制文件 */
function copyRecursiveSync(src: string, dest: string): void {
  cpSync(src, dest, { recursive: true, force: true })
}

/** 清理热更新，恢复到 asar 内置版本 */
export function clearHotUpdate(): void {
  const hotDir = HOT_DIR()
  rmSync(hotDir, { recursive: true, force: true })
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
