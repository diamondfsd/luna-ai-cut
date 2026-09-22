import { app, shell } from 'electron'
import { execFile } from 'node:child_process'
import { existsSync, renameSync, rmSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { createConnection, type Socket } from 'node:net'
import { promisify } from 'node:util'

import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService'
import { UsbAoaReceiver, type UsbAoaState, type UsbAoaStatus } from './usbAoaReceiver'
import type {
  DesktopVirtualCameraExtensionState,
  DesktopVirtualCameraOptions,
  DesktopVirtualCameraState,
  DesktopVirtualCameraStatus,
} from '../../../src/shared/types'

const execFileAsync = promisify(execFile)
const EXTENSION_IDENTIFIER = 'com.diamondfsd.luna.virtualcamera.host.extension'
const APP_NAME = 'LunaCameraHost.app'
const INSTALLED_HOST_PATH = `/Applications/${APP_NAME}`
const HOST_EXECUTABLE_PATH = `${INSTALLED_HOST_PATH}/Contents/MacOS/LunaCameraHost`
const DEFAULT_PORT = 4184

interface ActiveSession {
  state: 'starting' | 'running' | 'stopping'
  socket: Socket
  receiver: UsbAoaReceiver
  startedAt: string
  error: string | null
}

const IDLE_USB_STATUS: UsbAoaStatus = {
  state: 'idle',
  message: 'USB AOA 接收器未启动',
  deviceLabel: null,
  vendorId: null,
  productId: null,
  frames: 0,
  bytes: 0,
  lastFrameAt: null,
  error: null,
}

let activeSession: ActiveSession | null = null
let operation: Promise<DesktopVirtualCameraStatus> | null = null

async function execText(command: string, args: string[]): Promise<string> {
  const result = await execFileAsync(command, args, { encoding: 'utf8' })
  return String(result.stdout)
}

function installSourcePath(): string | null {
  const candidates = app.isPackaged
    ? [join(process.resourcesPath, 'desktop-virtual-camera', APP_NAME)]
    : [
        join(app.getAppPath(), 'desktop_virtual_camera', 'macos', '.build', 'SignedData', 'Build', 'Products', 'Debug', APP_NAME),
        join(app.getAppPath(), 'desktop_virtual_camera', 'macos', 'build', 'Debug', APP_NAME),
      ]
  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

function sourcePathOrThrow(): string {
  const source = installSourcePath()
  if (!source) {
    throw new Error('未找到已签名的 LunaCameraHost.app。请先运行 pnpm build:desktop-camera。')
  }
  return source
}

async function isHostRunning(): Promise<boolean> {
  try {
    await execFileAsync('pgrep', ['-f', `^${HOST_EXECUTABLE_PATH}$`], { encoding: 'utf8' })
    return true
  } catch {
    return false
  }
}

async function readExtensionState(): Promise<{
  installed: boolean
  enabled: boolean
  state: DesktopVirtualCameraExtensionState
}> {
  try {
    const output = await execText('/usr/bin/systemextensionsctl', ['list'])
    const line = output.split('\n').find((entry) => entry.includes(EXTENSION_IDENTIFIER))
    if (!line) return { installed: false, enabled: false, state: 'not-found' }
    const stateText = line.match(/\[([^\]]+)]\s*$/)?.[1] ?? ''
    if (stateText.includes('activated enabled')) {
      return { installed: true, enabled: true, state: 'enabled' }
    }
    if (stateText.includes('waiting for user')) {
      return { installed: true, enabled: false, state: 'waiting-approval' }
    }
    if (stateText.includes('activated disabled') || stateText.includes('disabled')) {
      return { installed: true, enabled: false, state: 'disabled' }
    }
    return { installed: true, enabled: false, state: 'unknown' }
  } catch {
    return { installed: false, enabled: false, state: 'unknown' }
  }
}

function statusState(
  unsupported: boolean,
  hostInstalled: boolean,
  extensionState: DesktopVirtualCameraExtensionState,
  usbState: UsbAoaState,
): DesktopVirtualCameraState {
  if (unsupported) return 'unsupported'
  if (!hostInstalled) return 'not-installed'
  if (extensionState === 'waiting-approval' || extensionState === 'disabled') return 'needs-approval'
  if (usbState === 'error') return 'error'
  if (activeSession) {
    if (usbState === 'waiting' || usbState === 'switching' || usbState === 'idle') return 'waiting-usb'
    return activeSession.state
  }
  if (extensionState === 'enabled') return 'ready'
  return 'not-installed'
}

function statusMessage(
  state: DesktopVirtualCameraState,
  extensionState: DesktopVirtualCameraExtensionState,
  sourceAvailable: boolean,
  usb: UsbAoaStatus,
): string {
  if (state === 'unsupported') {
    return process.platform === 'win32'
      ? 'Windows 虚拟摄像头原生组件尚未构建'
      : '直播控制台当前未在当前平台启用'
  }
  if (state === 'waiting-usb') return usb.message
  if (state === 'running') return usb.message
  if (state === 'starting') return '正在启动虚拟摄像头接收端'
  if (state === 'stopping') return '正在停止虚拟摄像头输出'
  if (state === 'needs-approval') return '等待在系统设置中启用 Luna Virtual Camera Extension'
  if (extensionState === 'not-found' && sourceAvailable) return 'Luna Camera Host 尚未安装'
  if (state === 'ready') return '相机扩展已启用，连接手机 USB 后即可输出'
  return '尚未安装可用的 Luna Camera Host'
}

export async function getDesktopVirtualCameraStatus(): Promise<DesktopVirtualCameraStatus> {
  const unsupported = process.platform !== 'darwin'
  const hostInstalled = !unsupported && existsSync(INSTALLED_HOST_PATH)
  const source = unsupported ? null : installSourcePath()
  const extension = unsupported
    ? { installed: false, enabled: false, state: 'unknown' as const }
    : await readExtensionState()
  const usb = activeSession?.receiver.status() ?? IDLE_USB_STATUS
  const hostRunning = !unsupported && await isHostRunning()
  const state = statusState(unsupported, hostInstalled, extension.state, usb.state)

  return {
    state,
    platform: process.platform,
    hostAppInstalled: hostInstalled,
    bundledHostAvailable: Boolean(source),
    hostAppPath: hostInstalled ? INSTALLED_HOST_PATH : source,
    installSourcePath: source,
    extensionIdentifier: EXTENSION_IDENTIFIER,
    extensionInstalled: extension.installed,
    extensionEnabled: extension.enabled,
    extensionState: extension.state,
    hostRunning,
    receiverConnected: usb.state === 'connected' || usb.state === 'streaming',
    transport: 'usb-aoa',
    usbState: usb.state,
    usbMessage: usb.message,
    usbDeviceLabel: usb.deviceLabel,
    usbVendorId: usb.vendorId,
    usbProductId: usb.productId,
    port: activeSession?.socket.remotePort ?? DEFAULT_PORT,
    frames: usb.frames,
    bytes: usb.bytes,
    lastFrameAt: usb.lastFrameAt,
    startedAt: activeSession?.startedAt ?? null,
    message: activeSession?.error ?? usb.error ?? statusMessage(state, extension.state, Boolean(source), usb),
    error: activeSession?.error ?? usb.error ?? null,
  }
}

async function stageHostApp(source: string): Promise<void> {
  const stagedPath = `/Applications/.${APP_NAME}.${process.pid}.staged`
  rmSync(stagedPath, { recursive: true, force: true })
  await execFileAsync('/usr/bin/ditto', [source, stagedPath], { encoding: 'utf8' })
  rmSync(INSTALLED_HOST_PATH, { recursive: true, force: true })
  renameSync(stagedPath, INSTALLED_HOST_PATH)
}

export function installDesktopVirtualCameraHost(): Promise<DesktopVirtualCameraStatus> {
  if (operation) return operation
  const task = (async () => {
    if (process.platform !== 'darwin') return getDesktopVirtualCameraStatus()
    const source = sourcePathOrThrow()
    await stageHostApp(source)
    await execFileAsync('/usr/bin/open', [INSTALLED_HOST_PATH], { encoding: 'utf8' })
    logMainInfo('[虚拟摄像头] Luna Camera Host 已安装', { source })
    return getDesktopVirtualCameraStatus()
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

async function waitForHost(): Promise<void> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (await isHostRunning()) return
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
  throw new Error('Luna Camera Host 启动超时')
}

function connectToHost(port: number, timeoutMs = 5_000): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now()
    const tryConnect = () => {
      const socket = createConnection({ host: '127.0.0.1', port })
      socket.once('connect', () => {
        socket.off('error', onError)
        resolve(socket)
      })
      const onError = () => {
        socket.destroy()
        if (Date.now() - startedAt >= timeoutMs) {
          reject(new Error(`无法连接虚拟摄像头接收端口 ${port}`))
          return
        }
        setTimeout(tryConnect, 150)
      }
      socket.once('error', onError)
    }
    tryConnect()
  })
}

export function startDesktopVirtualCamera(options: DesktopVirtualCameraOptions): Promise<DesktopVirtualCameraStatus> {
  if (operation) return operation
  const task = (async () => {
    if (process.platform !== 'darwin') return getDesktopVirtualCameraStatus()
    if (activeSession) return getDesktopVirtualCameraStatus()
    if (!existsSync(INSTALLED_HOST_PATH)) await installDesktopVirtualCameraHost()

    const runtime = await getDesktopVirtualCameraStatus()
    if (!runtime.extensionEnabled) {
      await openDesktopVirtualCameraSettings()
      throw new Error('请先在系统设置中启用 Luna Virtual Camera Extension，然后重试')
    }

    if (!await isHostRunning()) {
      await execFileAsync('/usr/bin/open', [INSTALLED_HOST_PATH], { encoding: 'utf8' })
      await waitForHost()
    }

    const port = options.port ?? DEFAULT_PORT
    const socket = await connectToHost(port)
    const receiver = new UsbAoaReceiver((frame) => {
      if (activeSession?.receiver !== receiver || socket.destroyed || !socket.writable || socket.writableNeedDrain) return
      socket.write(frame)
    })
    const session: ActiveSession = {
      state: 'running',
      socket,
      receiver,
      startedAt: new Date().toISOString(),
      error: null,
    }
    activeSession = session
    socket.once('close', () => {
      if (activeSession === session) session.error = '虚拟摄像头接收连接已断开'
    })
    receiver.start()
    logMainInfo('[虚拟摄像头] USB AOA 接收已启动', { port })
    return getDesktopVirtualCameraStatus()
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

function clearPublishedFrame(): void {
  const candidates = [
    '/tmp/latest-bgra.frame',
    join(homedir(), 'Library', 'Group Containers', '8B6J8663PS.com.diamondfsd.luna.virtualcamera', 'latest-bgra.frame'),
  ]
  for (const candidate of candidates) rmSync(candidate, { force: true })
}

export function stopDesktopVirtualCamera(): Promise<DesktopVirtualCameraStatus> {
  if (operation) return operation
  const task = (async () => {
    const session = activeSession
    if (session) {
      session.state = 'stopping'
      await session.receiver.stop()
      session.socket.end()
      session.socket.destroy()
      activeSession = null
    }
    clearPublishedFrame()
    if (process.platform === 'darwin' && await isHostRunning()) {
      await execFileAsync('/usr/bin/pkill', ['-TERM', '-f', `^${HOST_EXECUTABLE_PATH}$`], { encoding: 'utf8' }).catch(() => undefined)
    }
    logMainInfo('[虚拟摄像头] USB AOA 输出已停止')
    return getDesktopVirtualCameraStatus()
  })().finally(() => {
    operation = null
  })
  operation = task
  return task
}

export async function openDesktopVirtualCameraSettings(): Promise<void> {
  if (process.platform !== 'darwin') return
  await execFileAsync('/usr/bin/open', [
    `x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?extension=${EXTENSION_IDENTIFIER}`,
  ], { encoding: 'utf8' })
}

export function revealDesktopVirtualCameraSource(): void {
  const source = installSourcePath()
  if (!source) throw new Error('未找到 Luna Camera Host 构建产物')
  shell.showItemInFolder(source)
}

export async function stopDesktopVirtualCameraOnQuit(): Promise<void> {
  const session = activeSession
  if (!session) return
  await stopDesktopVirtualCamera().catch((error: unknown) => {
    logMainWarn('[虚拟摄像头] 退出清理失败', {
      error: error instanceof Error ? error.message : String(error),
    })
  })
}
