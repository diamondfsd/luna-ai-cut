import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { currentBaseDir, logDirForBaseDir } from '../storage/settingsService'
import { saveStartupFailure, type StartupFailureReport } from './startupDiagnostics'
import { startupPage } from './startup-animation/startupPage'
import { startupWindowState } from './startupWindowState'

const STARTUP_READY_CHANNEL = 'luna:startup-ready'
let startupWindow: BrowserWindow | null = null
let mainWindow: BrowserWindow | null = null
let creatingStartupWindow = false

function writeStartupFailure(error: unknown): StartupFailureReport {
  const logPaths: string[] = []
  try {
    logPaths.push(join(logDirForBaseDir(currentBaseDir()), 'startup.log'))
  } catch (pathError) {
    console.error('[startup] 无法读取日志目录', pathError)
  }
  logPaths.push(join(app.getPath('userData'), 'logs', 'startup.log'))
  logPaths.push(join(app.getPath('temp'), 'LunaAI-Cut', 'logs', 'startup.log'))
  return saveStartupFailure(error, [
    `版本：${app.getVersion()}`,
    `系统：${process.platform} ${process.arch}`,
    `启动来源：${process.env.LUNA_BOOT_SOURCE || 'bootstrap'}`,
    `应用：${process.execPath}`,
    `资源：${process.resourcesPath}`,
  ].join('\n'), logPaths)
}

async function showStartupFailure(report: StartupFailureReport, error: unknown): Promise<void> {
  const reason = error instanceof Error ? error.message : String(error)
  let actionError = ''
  const buttons = report.logPath ? ['复制诊断信息', '打开日志位置', '退出'] : ['复制诊断信息', '退出']
  let response = -1
  while (response !== buttons.length - 1) {
    const options = {
      type: 'error' as const,
      title: 'Luna AI Cut 暂时无法启动',
      message: '应用未能正常打开',
      detail: `原因：${reason.slice(0, 1600)}\n\n${report.logPath ? `日志：${report.logPath}` : '日志未能保存，可复制诊断信息。'}${actionError}`,
      buttons,
      defaultId: 0,
      cancelId: buttons.length - 1,
      noLink: true,
    }
    const parent = startupWindow && !startupWindow.isDestroyed() ? startupWindow : null
    const result = await (parent ? dialog.showMessageBox(parent, options) : dialog.showMessageBox(options))
    response = result.response
    if (result.response === buttons.length - 1) return
    actionError = ''
    try {
      if (result.response === 0 || !report.logPath) {
        clipboard.writeText(report.diagnostic)
      } else {
        shell.showItemInFolder(report.logPath)
      }
    } catch {
      actionError = '\n\n操作未完成，请重试。'
    }
  }
}

function cleanupStartupListeners(): void {
  process.removeListener('unhandledRejection', failStartup)
  ipcMain.removeListener(STARTUP_READY_CHANNEL, finishStartup)
  app.removeListener('browser-window-created', observeMainWindow)
}

function finishStartup(event: Electron.IpcMainEvent): void {
  if (!startupWindowState.pending || !mainWindow || mainWindow.isDestroyed()
    || event.sender !== mainWindow.webContents || event.senderFrame !== mainWindow.webContents.mainFrame) return
  startupWindowState.pending = false
  cleanupStartupListeners()
  mainWindow.show()
  mainWindow.focus()
  startupWindow?.close()
  startupWindow = null
}

export function failStartup(error: unknown): void {
  if (!startupWindowState.pending) return
  startupWindowState.pending = false
  cleanupStartupListeners()
  const report = writeStartupFailure(error)
  if (startupWindow && !startupWindow.isDestroyed()) {
    void startupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupPage(true))}`)
    startupWindow.show()
    startupWindow.focus()
  }
  void showStartupFailure(report, error).catch((promptError) => {
    console.error('[startup] 无法显示启动错误', promptError, report.diagnostic)
  }).finally(() => app.quit())
}

function createStartupWindow(): void {
  creatingStartupWindow = true
  try {
    startupWindow = new BrowserWindow({
      title: 'Luna AI Cut',
      width: 480,
      height: 354,
      frame: false,
      transparent: true,
      hasShadow: false,
      show: false,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: '#00000000',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
  } finally {
    creatingStartupWindow = false
  }
  startupWindow.center()
  startupWindow.once('ready-to-show', () => {
    if (startupWindowState.pending) startupWindow?.show()
  })
  void startupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupPage())}`)
  startupWindow.on('closed', () => { startupWindow = null })
}

function observeMainWindow(_event: Electron.Event, window: BrowserWindow): void {
  if (creatingStartupWindow || mainWindow) return
  mainWindow = window
  window.webContents.once('did-fail-load', (_loadEvent, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    window.hide()
    failStartup(new Error(`Main window failed to load (${code} ${description}): ${url}`))
  })
  window.webContents.once('render-process-gone', (_goneEvent, details) => {
    failStartup(new Error(`Renderer exited during startup: ${details.reason} (${details.exitCode})`))
  })
}

export function installStartupExperience(): void {
  startupWindowState.pending = true
  mainWindow = null
  app.on('browser-window-created', observeMainWindow)
  ipcMain.on(STARTUP_READY_CHANNEL, finishStartup)
  process.once('unhandledRejection', failStartup)
  createStartupWindow()
}
