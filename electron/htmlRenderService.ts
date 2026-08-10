import { BrowserWindow, session, type Session } from 'electron'

import { HTML_RENDER_SHELL_URL } from './htmlRenderShell'
import type { HtmlRenderRequest, HtmlRenderResult } from './htmlRenderTypes'

const HTML_RENDER_PARTITION = 'luna-html-renderer'
const MAX_DIMENSION = 8192
const MAX_PIXEL_COUNT = 33_554_432
const MAX_HTML_LENGTH = 2 * 1024 * 1024
const MAX_CSS_LENGTH = 2 * 1024 * 1024

let renderWindow: BrowserWindow | null = null
let creatingWindow: BrowserWindow | null = null
let renderWindowLoading: Promise<BrowserWindow> | null = null
let renderSession: Session | null = null
let renderQueue: Promise<void> = Promise.resolve()
let lifecycleRevision = 0

function validateRequest(request: HtmlRenderRequest): HtmlRenderRequest {
  if (!request || typeof request !== 'object') throw new Error('HTML render request is required')
  if (typeof request.html !== 'string' || request.html.length > MAX_HTML_LENGTH) {
    throw new Error('HTML source exceeds the 2 MB limit')
  }
  if (typeof request.css !== 'string' || request.css.length > MAX_CSS_LENGTH) {
    throw new Error('CSS source exceeds the 2 MB limit')
  }
  if (!Number.isInteger(request.width) || request.width < 1 || request.width > MAX_DIMENSION) {
    throw new Error(`Render width must be an integer between 1 and ${MAX_DIMENSION}`)
  }
  if (!Number.isInteger(request.height) || request.height < 1 || request.height > MAX_DIMENSION) {
    throw new Error(`Render height must be an integer between 1 and ${MAX_DIMENSION}`)
  }
  if (request.width * request.height > MAX_PIXEL_COUNT) {
    throw new Error('HTML render surface exceeds the pixel limit')
  }
  if (!Number.isFinite(request.timeMs) || request.timeMs < 0) {
    throw new Error('Render time must be a non-negative finite number')
  }
  return request
}

function getRenderSession(): Session {
  if (renderSession) return renderSession
  const isolatedSession = session.fromPartition(HTML_RENDER_PARTITION, { cache: false })
  isolatedSession.setPermissionCheckHandler(() => false)
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  isolatedSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const allowed = details.url.startsWith('data:')
      || details.url.startsWith('blob:')
      || details.url === 'about:blank'
      || details.url === 'about:srcdoc'
    callback({ cancel: !allowed })
  })
  renderSession = isolatedSession
  return isolatedSession
}

async function createRenderWindow(width: number, height: number): Promise<BrowserWindow> {
  const win = new BrowserWindow({
    show: false,
    width,
    height,
    useContentSize: true,
    transparent: true,
    backgroundColor: '#00000000',
    frame: false,
    skipTaskbar: true,
    webPreferences: {
      offscreen: true,
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      webSecurity: true,
      session: getRenderSession(),
      backgroundThrottling: false,
    },
  })
  creatingWindow = win
  win.setMenuBarVisibility(false)
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => event.preventDefault())
  win.webContents.on('will-redirect', (event) => event.preventDefault())
  win.webContents.on('will-attach-webview', (event) => event.preventDefault())
  win.webContents.on('render-process-gone', () => {
    if (!win.isDestroyed()) win.destroy()
  })
  win.once('closed', () => {
    if (renderWindow === win) renderWindow = null
    if (creatingWindow === win) creatingWindow = null
  })
  try {
    await win.loadURL(HTML_RENDER_SHELL_URL)
    if (win.isDestroyed()) throw new Error('HTML render window closed while loading')
    if (creatingWindow === win) creatingWindow = null
    return win
  } catch (error) {
    if (!win.isDestroyed()) win.destroy()
    throw error
  }
}

async function getRenderWindow(width: number, height: number): Promise<BrowserWindow> {
  if (renderWindow && !renderWindow.isDestroyed()) {
    renderWindow.setContentSize(width, height, false)
    return renderWindow
  }
  if (!renderWindowLoading) {
    const loading = createRenderWindow(width, height)
      .then((win) => {
        renderWindow = win
        return win
      })
      .finally(() => {
        if (renderWindowLoading === loading) renderWindowLoading = null
      })
    renderWindowLoading = loading
  }
  const win = await renderWindowLoading
  win.setContentSize(width, height, false)
  return win
}

async function renderHtmlFrame(request: HtmlRenderRequest): Promise<HtmlRenderResult> {
  const input = validateRequest(request)
  const win = await getRenderWindow(input.width, input.height)
  const payload = JSON.stringify(input)
  const shellResult = await win.webContents.executeJavaScript(
    `window.__lunaRenderHtml(${payload})`,
    true,
  ) as { warnings?: unknown }
  if (win.isDestroyed()) throw new Error('HTML render window closed before capture')

  let image = await win.webContents.capturePage({
    x: 0,
    y: 0,
    width: input.width,
    height: input.height,
  })
  if (image.isEmpty()) throw new Error('HTML renderer produced an empty frame')
  const imageSize = image.getSize()
  if (imageSize.width !== input.width || imageSize.height !== input.height) {
    image = image.resize({ width: input.width, height: input.height, quality: 'best' })
  }
  const png = image.toPNG()
  const bytes = png.buffer.slice(png.byteOffset, png.byteOffset + png.byteLength) as ArrayBuffer
  return {
    png: bytes,
    width: input.width,
    height: input.height,
    warnings: Array.isArray(shellResult?.warnings)
      ? shellResult.warnings.filter((warning): warning is string => typeof warning === 'string')
      : [],
  }
}

export function renderHtmlToPng(request: HtmlRenderRequest): Promise<HtmlRenderResult> {
  const requestedRevision = lifecycleRevision
  const task = renderQueue.then(() => {
    if (requestedRevision !== lifecycleRevision) throw new Error('HTML render request was canceled')
    return renderHtmlFrame(request)
  })
  renderQueue = task.then(() => undefined, () => undefined)
  return task
}

export function shutdownHtmlRenderService(): void {
  lifecycleRevision += 1
  renderWindowLoading = null
  if (creatingWindow && !creatingWindow.isDestroyed()) creatingWindow.destroy()
  if (renderWindow && !renderWindow.isDestroyed()) renderWindow.destroy()
  creatingWindow = null
  renderWindow = null
}
