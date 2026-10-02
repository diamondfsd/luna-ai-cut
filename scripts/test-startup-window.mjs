import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'

function loadModule(file, dependencies) {
  const source = readFileSync(new URL(file, import.meta.url), 'utf8')
  const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
  }).outputText
  const exports = {}
  vm.runInNewContext(compiled, {
    exports,
    require: name => {
      assert.ok(name in dependencies, `Unexpected dependency: ${name}`)
      return dependencies[name]
    },
    process: { platform: 'linux', arch: 'x64', env: {}, execPath: '/app',
      removeListener() {}, once() {} },
    console,
  })
  return exports
}

function setup() {
  const app = new EventEmitter()
  Object.assign(app, { getPath: () => '/tmp', getVersion: () => '1.9.0', quit() {} })
  const ipcMain = new EventEmitter()
  const windows = []
  const state = { pending: false }
  class BrowserWindow extends EventEmitter {
    constructor(options) {
      super()
      this.options = options
      this.visible = false
      this.destroyed = false
      this.webContents = new EventEmitter()
      this.webContents.mainFrame = {}
      this.webContents.session = { setPermissionRequestHandler() {} }
      windows.push(this)
      app.emit('browser-window-created', {}, this)
    }
    center() {}
    isDestroyed() { return this.destroyed }
    isVisible() { return this.visible }
    isMinimized() { return false }
    focus() {}
    show() { this.visible = true }
    hide() { this.visible = false }
    close() { this.destroyed = true; this.visible = false; this.emit('closed') }
    async loadURL(url) { this.url = url }
    async loadFile(file) { this.file = file }
  }
  const electron = { app, BrowserWindow, ipcMain, clipboard: {}, shell: {},
    dialog: { showMessageBox: async () => ({ response: 1 }) } }
  const service = loadModule('../electron/infrastructure/startupWindowService.ts', {
    electron,
    'node:path': { join: (...parts) => parts.join('/') },
    '../storage/settingsService': { currentBaseDir: () => '/base', logDirForBaseDir: () => '/logs' },
    './startupDiagnostics': { saveStartupFailure: () => ({ logPath: null, diagnostic: 'failure' }) },
    './startup-animation/startupPage': { startupPage: failed => failed ? 'failure' : 'animation' },
    './startupWindowState': { startupWindowState: state },
  })
  const mainService = loadModule('../electron/application/windowService.ts', {
    electron,
    'node:path': { default: { join: (...parts) => parts.join('/') } },
    '../infrastructure/startupWindowState': { startupWindowState: state },
  })
  service.installStartupExperience()
  const main = mainService.createMainWindow({ devServerUrl: 'http://localhost', iconPath: '', preloadPath: '',
    rendererDist: '', hasActiveDownloads: () => false, hasActiveExports: () => false,
    getWindowCloseBehavior: () => 'quit' })
  return { state, service, ipcMain, main, splash: windows[0] }
}

const loading = setup()
assert.equal(loading.splash.options.frame, false)
assert.equal(loading.splash.options.transparent, true)
loading.splash.emit('ready-to-show')
assert.equal(loading.splash.visible, true)
loading.main.emit('ready-to-show')
loading.main.webContents.emit('did-finish-load')
assert.equal(loading.main.visible, false)
assert.equal(loading.splash.destroyed, false)
loading.ipcMain.emit('luna:startup-ready', { sender: loading.splash.webContents,
  senderFrame: loading.splash.webContents.mainFrame })
assert.equal(loading.state.pending, true)
loading.ipcMain.emit('luna:startup-ready', { sender: loading.main.webContents, senderFrame: {} })
assert.equal(loading.state.pending, true)
loading.ipcMain.emit('luna:startup-ready', { sender: loading.main.webContents,
  senderFrame: loading.main.webContents.mainFrame })
assert.equal(loading.main.visible, true)
assert.equal(loading.splash.destroyed, true)
assert.equal(loading.ipcMain.listenerCount('luna:startup-ready'), 0)

const failure = setup()
failure.main.webContents.emit('did-fail-load', {}, -2, 'failed', 'http://localhost', true)
assert.equal(failure.main.visible, false)
assert.equal(failure.splash.visible, true)
assert.equal(failure.splash.url, 'data:text/html;charset=utf-8,failure')
assert.equal(failure.state.pending, false)

const page = loadModule('../electron/infrastructure/startup-animation/startupPage.ts', {
  './start-page.mp4?inline': { default: 'data:video/mp4;base64,fixture' },
  './startup-page.css?inline': { default: 'body{background:transparent}' },
})
assert.match(page.startupPage(), /autoplay muted loop playsinline/)
assert.match(page.startupPage(), /media-src data:/)
assert.doesNotMatch(page.startupPage(true), /<video/)
const assets = loadModule('./vite-inline-startup-video.ts', { 'node:fs': { readFileSync } })
const videoPath = fileURLToPath(new URL('../electron/infrastructure/startup-animation/start-page.mp4', import.meta.url))
const plugin = assets.inlineStartupVideo()
const inlineModule = plugin.load(`${videoPath}?inline`)
const dataUrl = JSON.parse(inlineModule.slice('export default '.length))
assert.ok(dataUrl.startsWith('data:video/mp4;base64,'))
assert.deepEqual(Buffer.from(dataUrl.split(',')[1], 'base64'), readFileSync(videoPath))
assert.equal(plugin.load('/unrelated.mp4?inline'), null)
console.log('Startup video lifecycle checks passed')
