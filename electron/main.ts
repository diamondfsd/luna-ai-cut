/**
 * main.ts — 热更新引导加载器（Bootstrap）
 *
 * 这是 Electron 入口（package.json "main" 指向此文件编译产物）。
 * 功能：检查 userData/.luna-hot/ 是否有热更新版本，有则加载之，否则加载 asar 内置版本。
 *
 * ⚠️ 此文件应保持极简，只做路径判断和动态 import，不要引入业务逻辑。
 *    改动此文件意味着需要发布完整安装包，丧失热更新优势。
 */
import { app, protocol } from 'electron'
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { canLoadHotUpdate } from '../src/shared/hotUpdateCompatibility'
import { failStartup, installStartupExperience } from './startupWindowService'

const e2eUserDataDir = process.env.LUNA_E2E_USER_DATA_DIR
if (!app.isPackaged && e2eUserDataDir) {
  const isolatedUserData = resolve(e2eUserDataDir)
  app.setPath('userData', isolatedUserData)
  // Chromium's origin-scoped storage, including OPFS, lives in sessionData.
  app.setPath('sessionData', join(isolatedUserData, 'session-data'))
}

// `file://` has an opaque, unstable origin in Electron. The renderer uses a
// stable, secure application origin so the File System Access API can restore
// permissions for the user-selected FreeCut workspace across normal launches.
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'luna',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      corsEnabled: true,
    },
  },
])

async function boot(): Promise<void> {
  // 开发模式跳过热更新，避免本地代码被热更新覆盖
  if (!app.isPackaged) {
    process.env.LUNA_BOOT_SOURCE = 'development'
    await import('./appMain.ts')
    return
  }

  const hotDir = join(app.getPath('userData'), '.luna-hot')
  const versionFile = join(hotDir, 'version.json')
  const hotMain = join(hotDir, 'dist-electron', 'luna-appMain.js')

  activatePendingNativeUpdate(hotDir)

  // 检查是否有有效的热更新版本
  let hotVersion = readHotVersion(versionFile)

  // 热更新只能覆盖完全相同的稳定安装版。Beta/RC 必须使用安装包内置代码，
  // 避免旧热更新同时替换主进程、页面和原生模块。
  const appVersion = app.getVersion()
  if (hotVersion && !canLoadHotUpdate(appVersion, hotVersion)) {
    console.log(`[hot-update] 热更新 ${hotVersion} 与安装版本 ${appVersion} 不兼容，丢弃旧热更新`)
    try {
      const { rmSync } = await import('node:fs')
      rmSync(hotDir, { recursive: true, force: true })
    } catch { /* ignore */ }
    hotVersion = null
  }

  if (hotVersion && existsSync(hotMain)) {
    console.log(`[hot-update] 加载热更新版本: ${hotVersion}`)
    try {
      process.env.LUNA_BOOT_SOURCE = `hot-update:${hotVersion}`
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
  process.env.LUNA_BOOT_SOURCE = 'bundled'
  await import('./appMain.ts')
}

/**
 * 原生模块在运行中的 Windows 进程内会被锁定，因此热更新先下载到
 * pending-native；新进程在加载热更新主进程前再移动到实际加载位置。
 */
function activatePendingNativeUpdate(hotDir: string): void {
  const pending = join(hotDir, 'pending-native', 'luna-render-core.node')
  if (!existsSync(pending)) return

  const targetDir = join(hotDir, 'luna-render-core')
  const target = join(targetDir, 'luna-render-core.node')
  mkdirSync(targetDir, { recursive: true })
  rmSync(target, { force: true })
  renameSync(pending, target)
  for (const file of [
    'dxcompiler.dll',
    'dxil.dll',
    'DXC-LICENSE-MIT.txt',
    'DXC-LICENSE-LLVM.txt',
    'DXC-LICENSE-MS.txt',
  ]) {
    const pendingRuntime = join(hotDir, 'pending-native', file)
    if (!existsSync(pendingRuntime)) continue
    const targetRuntime = join(targetDir, file)
    rmSync(targetRuntime, { force: true })
    renameSync(pendingRuntime, targetRuntime)
  }
  rmSync(join(hotDir, 'pending-native'), { recursive: true, force: true })
  console.log('[hot-update] 已切换原生渲染模块')
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

app.whenReady().then(async () => {
  installStartupExperience()
  await boot()
}).catch(failStartup)
