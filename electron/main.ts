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
  const hotVersion = readHotVersion(versionFile)

  if (hotVersion && existsSync(hotMain)) {
    // eslint-disable-next-line no-console
    console.log(`[hot-update] 加载热更新版本: ${hotVersion}`)
    try {
      await import(pathToFileURL(hotMain).href)
      return // 加载成功
    } catch (err) {
      // 热更新加载失败时降级到 asar 版本，并清除坏的热更新
      console.error('[hot-update] 热更新加载失败，降级到内置版本:', err)
      try {
        const { rmSync } = await import('node:fs')
        rmSync(hotDir, { recursive: true, force: true })
      } catch { /* ignore cleanup errors */ }
    }
  }
  // 加载 asar 内置的 fallback 版本
  // rollup 会将此动态 import 编译为名为 'luna-appMain.js' 的独立 chunk
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

app.whenReady().then(boot)
