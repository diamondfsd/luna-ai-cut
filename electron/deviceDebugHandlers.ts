/**
 * 设备调试服务 IPC 处理器
 * 提供一键测试和独立日志功能
 */

import { ipcMain, BrowserWindow } from 'electron'
import { runDeviceTest, writeDeviceDebugLog, getDeviceDebugLogPath, closeDeviceDebugLog } from './deviceDebugService'
import type { TestResult } from './deviceDebugService'

export function registerDeviceDebugHandlers(mainWindow: () => BrowserWindow | null): void {
  /**
   * deviceDebug:runTest — 运行一键测试
   * 测试过程中通过回调事件实时推送日志
   */
  ipcMain.handle('deviceDebug:runTest', async (_event, params: { deviceId: string; host: string }): Promise<TestResult> => {
    const { deviceId, host } = params

    const result = await runDeviceTest(deviceId, host, (level, message, data) => {
      // 通过 WebContents 实时推送日志到渲染进程
      const win = mainWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('deviceDebug:log', { level, message, data })
      }
    })

    return result
  })

  /**
   * deviceDebug:log — 写入设备调试日志
   */
  ipcMain.handle('deviceDebug:log', (_event, params: { level: string; message: string; data?: unknown }) => {
    writeDeviceDebugLog(params.level, params.message, params.data)
    return { success: true }
  })

  /**
   * deviceDebug:getLogPath — 获取日志文件路径
   */
  ipcMain.handle('deviceDebug:getLogPath', () => {
    return getDeviceDebugLogPath()
  })
}

/** 清理资源 */
export function cleanupDeviceDebug(): void {
  closeDeviceDebugLog()
}
