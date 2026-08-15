import { app, BrowserWindow, dialog, net, protocol } from 'electron'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const RENDERER_PROTOCOL = 'luna'
const RENDERER_HOST = 'app'

interface MainWindowOptions {
  devServerUrl: string | undefined
  iconPath: string
  preloadPath: string
  rendererDist: string
  hasActiveDownloads: () => boolean
  hasActiveExports: () => boolean
  abortDownloads: () => void
  abortExports: () => void
}

function rendererFilePath(requestUrl: string, rendererDist: string): string | null {
  try {
    const url = new URL(requestUrl)
    if (url.protocol !== `${RENDERER_PROTOCOL}:` || url.hostname !== RENDERER_HOST) return null
    const pathname = decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)
    const candidate = path.resolve(rendererDist, `.${pathname}`)
    const relative = path.relative(rendererDist, candidate)
    if (relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) return null
    return candidate
  } catch {
    return null
  }
}

export function registerRendererProtocol(rendererDist: string): void {
  protocol.handle(RENDERER_PROTOCOL, (request) => {
    const filePath = rendererFilePath(request.url, rendererDist)
    if (!filePath) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(filePath).toString())
  })
}

export function activateMainWindow(win: BrowserWindow): void {
  if (win.isDestroyed()) return
  if (win.isMinimized()) win.restore()
  if (!win.isVisible()) win.show()
  win.focus()
  if (process.platform === 'darwin') app.focus({ steal: true })
}

export function createMainWindow(options: MainWindowOptions): BrowserWindow {
  let forceQuitAfterTaskCancel = false
  const win = new BrowserWindow({
    title: 'Luna AI Cut',
    width: 1280,
    height: 820,
    minWidth: 1040,
    minHeight: 680,
    show: false,
    icon: options.iconPath,
    autoHideMenuBar: true,
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: process.platform === 'darwin' ? { x: 16, y: 16 } : undefined,
    webPreferences: {
      preload: options.preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: false,
    },
  })

  // 阻止 HTML <title> 覆盖通过 win.setTitle() 设置的窗口标题
  win.on('page-title-updated', (event) => {
    event.preventDefault()
  })

  win.once('ready-to-show', () => activateMainWindow(win))

  win.on('close', (event) => {
    const hasDownloadTasks = options.hasActiveDownloads()
    const hasExportTasks = options.hasActiveExports()
    if (forceQuitAfterTaskCancel || (!hasDownloadTasks && !hasExportTasks)) return

    event.preventDefault()
    const tasks = [
      hasDownloadTasks ? '下载任务' : null,
      hasExportTasks ? '导出任务' : null,
    ].filter(Boolean).join('和')
    const result = dialog.showMessageBoxSync(win, {
      type: 'warning',
      buttons: ['先不退出', '终止任务并退出'],
      defaultId: 0,
      cancelId: 0,
      title: '仍有任务正在进行',
      message: `当前还有${tasks}正在进行。`,
      detail: '退出前需要先终止这些任务，未完成的文件不会继续处理。',
      noLink: true,
    })
    if (result !== 1) return

    options.abortDownloads()
    options.abortExports()
    forceQuitAfterTaskCancel = true
    win.close()
  })

  if (options.devServerUrl) {
    win.loadURL(options.devServerUrl)
  } else if (process.env.LUNA_E2E_RENDERER_ORIGIN === 'file') {
    win.loadFile(path.join(options.rendererDist, 'index.html'))
  } else {
    win.loadURL(`${RENDERER_PROTOCOL}://${RENDERER_HOST}/index.html`)
  }

  return win
}

export function appIconPath(appRoot: string): string {
  const iconName = process.platform === 'darwin' ? 'icon.icns' : 'icon.png'
  if (app.isPackaged) return path.join(process.resourcesPath, iconName)
  return path.join(appRoot, 'build', iconName)
}
