/**
 * main.ts — 热更新引导加载器（Bootstrap）
 *
 * 这是 Electron 入口（package.json "main" 指向此文件编译产物）。
 * 功能：检查 userData/.luna-hot/ 是否有热更新版本，有则加载之，否则加载 asar 内置版本。
 *
 * ⚠️ 此文件应保持极简，只做路径判断和动态 import，不要引入业务逻辑。
 *    改动此文件意味着需要发布完整安装包，丧失热更新优势。
 */
import { app } from 'electron'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

async function boot(): Promise<void> {
  const hotDir = join(app.getPath('userData'), '.luna-hot')
  const versionFile = join(hotDir, 'version.json')
  const hotMain = join(hotDir, 'dist-electron', 'luna-appMain.js')

  // 检查是否有有效的热更新版本
  let hotVersion = readHotVersion(versionFile)

  // 如果热更新的基础版本低于当前 app 版本，丢弃旧热更新（如 app 升到 1.3.2 后仍加载 1.3.1-hot.15）
  const appVersion = app.getVersion()
  const hotBaseVersion = parseHotBaseVersion(hotVersion)
  if (hotBaseVersion && hotVersion && compareVersions(appVersion, hotBaseVersion) > 0) {
    console.log(`[hot-update] 应用版本 ${appVersion} > 热更新基础版本 ${hotBaseVersion}，丢弃旧热更新`)
    try {
      const { rmSync } = await import('node:fs')
      rmSync(hotDir, { recursive: true, force: true })
    } catch { /* ignore */ }
    hotVersion = null
  }

  if (hotVersion && existsSync(hotMain)) {
    console.log(`[hot-update] 加载热更新版本: ${hotVersion}`)
    try {
      await import(pathToFileURL(hotMain).href)
      console.log(`[hot-update] 热更新加载成功: ${hotVersion}`)
      return
    } catch (err) {
      console.error('[hot-update] 热更新加载失败，降级到内置版本:', err)
      try {
        const { rmSync } = await import('node:fs')
        rmSync(hotDir, { recursive: true, force: true })
      } catch { /* ignore */ }
    }
  }
  // 加载 asar 内置的 fallback 版本
  await import('./appMain.ts')
}

function readHotVersion(filePath: string): string | null {
  try {
    if (!existsSync(filePath)) return null
    const data = JSON.parse(readFileSync(filePath, 'utf-8'))
    return typeof data.version === 'string' ? data.version : null
  } catch {
    return null
  }
}

/** 从 "1.3.1-hot.15" 中提取基础版本 "1.3.1" */
function parseHotBaseVersion(version: string | null): string | null {
  if (!version) return null
  const match = version.match(/^(\d+\.\d+\.\d+)-/)
  return match ? match[1] : null
}

/** 简单 semver 比较，返回 1 (a>b) / 0 (a==b) / -1 (a<b) */
function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map(Number)
  const pb = b.replace(/^v/, '').split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0
    const nb = pb[i] || 0
    if (na > nb) return 1
    if (na < nb) return -1
  }
  return 0
}

app.whenReady().then(boot)
