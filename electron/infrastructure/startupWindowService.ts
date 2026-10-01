import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import { currentBaseDir, logDirForBaseDir } from '../storage/settingsService'
import { saveStartupFailure, type StartupFailureReport } from './startupDiagnostics'

const STARTUP_READY_CHANNEL = 'luna:startup-ready'
let startupWindow: BrowserWindow | null = null
let startupPending = true
let creatingStartupWindow = false

function startupPage(failed = false): string {
  const title = failed ? 'Luna AI Cut 暂时无法启动' : 'Luna AI Cut'
  const message = failed ? '请关闭应用后重试。若仍无法打开，请重新安装最新版。' : '正在准备工作区…'
  const spinner = failed ? '' : '<div class="spinner" aria-hidden="true"></div>'
  return `<!doctype html><html lang="zh-CN"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>
    :root{color-scheme:light;font-family:"Segoe UI","Microsoft YaHei UI",sans-serif;background:#f5f7fa;color:#182230}
    *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;text-align:center}
    main{width:100%;padding:32px}h1{margin:0 0 12px;font-size:24px;font-weight:650;letter-spacing:0}
    p{margin:0;color:#667085;font-size:14px;line-height:1.6}.spinner{width:28px;height:28px;margin:0 auto 22px;border:3px solid #d9e2ec;border-top-color:#0066cc;border-radius:50%;animation:spin .8s linear infinite}
    @keyframes spin{to{transform:rotate(360deg)}}
  </style><title>${title}</title></head><body><main>${spinner}<h1>${title}</h1><p id="status">${message}</p></main>
  ${failed ? '' : '<script>setTimeout(()=>{document.getElementById("status").textContent="首次启动可能需要多一点时间，请稍候…"},15000)</script>'}</body></html>`
}

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

function finishStartup(): void {
  if (!startupPending) return
  startupPending = false
  cleanupStartupListeners()
  startupWindow?.close()
  startupWindow = null
}

export function failStartup(error: unknown): void {
  if (!startupPending) return
  startupPending = false
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
      width: 440,
      height: 280,
      minWidth: 440,
      minHeight: 280,
      resizable: false,
      maximizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: '#f5f7fa',
      webPreferences: { contextIsolation: true, nodeIntegration: false },
    })
  } finally {
    creatingStartupWindow = false
  }
  startupWindow.center()
  void startupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupPage())}`)
  startupWindow.on('closed', () => { startupWindow = null })
}

function observeMainWindow(_event: Electron.Event, window: BrowserWindow): void {
  if (creatingStartupWindow) return
  let fallbackTimer: NodeJS.Timeout | undefined
  window.webContents.once('did-finish-load', () => {
    // 兼容尚未包含启动通知的旧热更新页面。
    fallbackTimer = setTimeout(finishStartup, 5_000)
  })
  window.webContents.once('did-fail-load', (_loadEvent, code, description, url, isMainFrame) => {
    if (!isMainFrame || code === -3) return
    if (fallbackTimer) clearTimeout(fallbackTimer)
    window.hide()
    failStartup(new Error(`Main window failed to load (${code} ${description}): ${url}`))
  })
  window.webContents.once('render-process-gone', (_goneEvent, details) => {
    if (fallbackTimer) clearTimeout(fallbackTimer)
    failStartup(new Error(`Renderer exited during startup: ${details.reason} (${details.exitCode})`))
  })
}

export function installStartupExperience(): void {
  app.on('browser-window-created', observeMainWindow)
  ipcMain.once(STARTUP_READY_CHANNEL, finishStartup)
  process.once('unhandledRejection', failStartup)
  createStartupWindow()
}
