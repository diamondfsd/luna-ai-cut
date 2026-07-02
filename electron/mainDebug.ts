/**
 * mainDebug.ts — 设备调试版引导加载器
 *
 * 这是 Electron 入口（package.json "main" 指向此文件编译产物）。
 * 极简版本，不含热更新逻辑，专用于设备调试独立包。
 */
import { app } from 'electron'

async function boot(): Promise<void> {
  await import('./appMainDebug.ts')
}

app.whenReady().then(boot).catch((err) => {
  console.error('[mainDebug] 启动失败:', err)
  app.quit()
})
