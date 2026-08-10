import { app, BrowserWindow, ipcMain, type WebContents } from 'electron'

import { renderHtmlToPng, shutdownHtmlRenderService } from './htmlRenderService'
import type { HtmlRenderRequest } from './htmlRenderTypes'

const observedOwners = new WeakSet<BrowserWindow>()

function observeOwner(webContents: WebContents): void {
  const owner = BrowserWindow.fromWebContents(webContents)
  if (!owner || observedOwners.has(owner)) return
  observedOwners.add(owner)
  owner.once('closed', shutdownHtmlRenderService)
}

export function register(): void {
  ipcMain.handle('html-render:render', (event, request: HtmlRenderRequest) => {
    observeOwner(event.sender)
    return renderHtmlToPng(request)
  })
  app.once('before-quit', shutdownHtmlRenderService)
}
