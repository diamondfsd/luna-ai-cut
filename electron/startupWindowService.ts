import { app, BrowserWindow, dialog, ipcMain } from 'electron'
import { appendFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { currentBaseDir, logDirForBaseDir } from './settingsService'

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

function writeStartupFailure(error: unknown): void {
  try {
    const logDir = logDirForBaseDir(currentBaseDir())
    mkdirSync(logDir, { recursive: true })
    const detail = error instanceof Error ? (error.stack || error.message) : String(error)
    appendFileSync(join(logDir, 'startup.log'), `[${new Date().toISOString()}] ${detail}\n`, 'utf8')
  } catch {
    // 启动日志不可写时仍继续显示错误提示。
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
  writeStartupFailure(error)
  if (startupWindow && !startupWindow.isDestroyed()) {
    void startupWindow.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(startupPage(true))}`)
    startupWindow.show()
    startupWindow.focus()
  }
  const options = {
    type: 'error' as const,
    title: 'Luna AI Cut 暂时无法启动',
    message: '应用未能正常打开',
    detail: '请关闭应用后重试。若仍无法打开，请重新安装最新版。',
    buttons: ['知道了'],
  }
  const prompt = startupWindow ? dialog.showMessageBox(startupWindow, options) : dialog.showMessageBox(options)
  void prompt.finally(() => app.quit())
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
