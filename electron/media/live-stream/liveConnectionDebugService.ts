import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { createServer, createConnection, type Socket } from 'node:net'
import { randomUUID } from 'node:crypto'

import type {
  LiveConnectionDebugReport,
  LiveConnectionDebugStep,
  LiveConnectionDebugTarget,
  LiveStreamStatus,
} from '../../../src/shared/types/liveStream'
import { bundledAdbBinary, createAdbForward, createAdbRunner, parseAdbDevices, removeAdbForward } from './androidAdbClient.ts'
import { bundledHdcBinary, createHdcForward, createHdcRunner, parseHdcTargets, removeHdcForward } from './harmonyHdcClient.ts'
import { iosUsbToolBinary } from './iosUsbTool'
import { parseIdeviceIdOutput } from './iosDeviceDiscovery'
import { consumeFrames, USB_STREAM_CONTROL_RESULT } from './usbAoaProtocol.ts'
import { encodeControlFrame } from './usbMediaReceiver.ts'
import type { AdbForward, RunAdb } from './androidAdbClient.ts'

const PHONE_LIVE_PORT = 4184
const CONNECT_TIMEOUT_MS = 1_500
const HANDSHAKE_TIMEOUT_MS = 4_000

type DeviceTarget = 'ios' | 'android-adb' | 'harmony-hdc'

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function deviceSafeError(error: unknown, serial: string): Error {
  return new Error(errorText(error).split(serial).join('手机'))
}

function toolSafeError(error: unknown, binary: string): Error {
  return new Error(errorText(error).split(binary).join('连接工具'))
}

function runFile(binary: string, args: string[], timeout = 5_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(binary, args, { windowsHide: true, timeout, maxBuffer: 64 * 1024 }, (error, stdout, stderr) => {
      if (error) {
        reject(toolSafeError(stderr.trim() || error.message, binary))
        return
      }
      resolve(stdout.trim())
    })
  })
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function allocateLocalPort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('无法分配本地连接端口')
  const port = address.port
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  return port
}

function connectLocalPort(port: number, timeoutMs: number): Promise<Socket> {
  return new Promise((resolve, reject) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.off('connect', onConnect)
      socket.off('error', onError)
      if (error) {
        socket.destroy()
        reject(error)
      } else resolve(socket)
    }
    const onConnect = () => finish()
    const onError = (error: Error) => finish(error)
    const timer = setTimeout(() => finish(new Error('本地转发端口连接超时')), timeoutMs)
    socket.once('connect', onConnect)
    socket.once('error', onError)
  })
}

async function waitForLocalPort(port: number, child?: ChildProcess): Promise<Socket> {
  const deadline = Date.now() + 5_000
  let lastError: unknown = null
  while (Date.now() < deadline) {
    if ((child?.exitCode !== null && child?.exitCode !== undefined) || child?.signalCode) {
      throw new Error('iproxy 已退出，未能打开本地转发端口')
    }
    try {
      return await connectLocalPort(port, CONNECT_TIMEOUT_MS)
    } catch (error) {
      lastError = error
      await wait(150)
    }
  }
  throw new Error(lastError ? `本地转发端口未打开：${errorText(lastError)}` : '本地转发端口未打开')
}

function testPhoneService(socket: Socket): Promise<void> {
  const requestId = randomUUID()
  const request = {
    version: 1 as const,
    requestId,
    delivery: 'transactional' as const,
    type: 'capabilities.get' as const,
  }
  const frame = encodeControlFrame(request, 0)

  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0)
    let settled = false
    const finish = (error?: Error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      socket.off('data', onData)
      socket.off('error', onError)
      socket.off('close', onClose)
      if (error) reject(error)
      else resolve()
    }
    const onData = (chunk: Buffer) => {
      pending = consumeFrames(Buffer.concat([pending, chunk]), (received) => {
        if (received.streamType !== USB_STREAM_CONTROL_RESULT || received.controlResult?.requestId !== requestId) return
        if (received.controlResult.ok) finish()
        else finish(new Error(received.controlResult.error || '手机拒绝了直播连接检测'))
      }, () => undefined)
    }
    const onError = (error: Error) => finish(error)
    const onClose = () => finish(new Error('手机直播服务已断开'))
    const timer = setTimeout(() => finish(new Error('未收到手机直播服务响应，请打开手机端直播后重试')), HANDSHAKE_TIMEOUT_MS)
    socket.on('data', onData)
    socket.once('error', onError)
    socket.once('close', onClose)
    socket.write(frame, (error) => {
      if (error) finish(error)
    })
  })
}

function stopChild(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve()
  return new Promise((resolve) => {
    let settled = false
    const finish = () => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      child.off('close', finish)
      resolve()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish()
    }, 1_000)
    child.once('close', finish)
    child.kill('SIGTERM')
  })
}

function targetTransport(target: DeviceTarget): LiveStreamStatus['transport'] {
  if (target === 'ios') return 'ios-tcp'
  if (target === 'android-adb') return 'android-adb'
  return 'harmony-hdc'
}

function diagnosticDetail(status: LiveStreamStatus): string {
  const detail = status.connectionDiagnostics?.map((item) => item.message).filter(Boolean).join('；')
  return detail || status.error || status.usbMessage || '手机当前未响应直播连接检测'
}

export async function diagnoseLiveConnection(target: LiveConnectionDebugTarget, activeStatus?: LiveStreamStatus): Promise<LiveConnectionDebugReport> {
  const started = Date.now()
  const startedAt = new Date(started).toISOString()
  const steps: LiveConnectionDebugStep[] = []
  const add = (id: string, title: string, state: LiveConnectionDebugStep['state'], detail: string, at = Date.now()) => {
    steps.push({ id, title, state, detail, durationMs: Math.max(0, Date.now() - at) })
  }
  const run = async <T,>(id: string, title: string, action: () => Promise<{ value: T; detail: string }>): Promise<T | null> => {
    const at = Date.now()
    try {
      const result = await action()
      add(id, title, 'passed', result.detail, at)
      return result.value
    } catch (error) {
      add(id, title, 'failed', errorText(error), at)
      return null
    }
  }
  const skip = (id: string, title: string, detail: string) => add(id, title, 'skipped', detail)

  const finish = (): LiveConnectionDebugReport => ({
    target,
    platform: `${process.platform}-${process.arch}`,
    startedAt,
    completedAt: new Date().toISOString(),
    state: steps.some((step) => step.state === 'failed') ? 'failed' : 'passed',
    steps,
  })

  let binary: string | null = null
  let runner: RunAdb | null = null
  let phoneId: string | null = null

  if (target === 'ios') {
    const supported = process.platform === 'darwin' || (process.platform === 'win32' && process.arch === 'x64')
    if (!supported) {
      add('tools', 'iPhone 连接工具', 'failed', '当前系统暂不支持 iPhone USB 连接检测')
      skip('device', 'iPhone USB 识别', '连接工具不可用')
      skip('forward', 'iproxy 转发启动', '连接工具不可用')
      skip('port', '本机转发端口连通', '连接工具不可用')
      skip('handshake', '手机直播服务响应', '连接工具不可用')
      return finish()
    }
    const proxyBinary = iosUsbToolBinary('iproxy')
    const idBinary = iosUsbToolBinary('idevice_id')
    if (!proxyBinary || !idBinary) {
      add('tools', 'iPhone 连接工具', 'failed', '缺少 iPhone USB 连接工具，请重新安装应用')
      skip('device', 'iPhone USB 识别', '连接工具不可用')
      skip('forward', 'iproxy 转发启动', '连接工具不可用')
      skip('port', '本机转发端口连通', '连接工具不可用')
      skip('handshake', '手机直播服务响应', '连接工具不可用')
      return finish()
    }
    add('tools', 'iPhone 连接工具', 'passed', 'iproxy 与设备识别工具可用')
    const ids = await run('device', 'iPhone USB 识别', async () => {
      const output = await runFile(idBinary, ['-l'])
      const values = parseIdeviceIdOutput(output)
      if (values.length === 0) throw new Error('未识别到 iPhone，请解锁手机并确认信任提示')
      if (values.length > 1) throw new Error('检测到多台 iPhone，请只保留一台手机连接')
      return { value: values, detail: '已识别到 1 台 iPhone' }
    })
    phoneId = ids?.[0] ?? null
    if (!phoneId) {
      skip('forward', 'iproxy 转发启动', 'iPhone 未通过 USB 识别')
      skip('port', '本机转发端口连通', 'iPhone 未通过 USB 识别')
      skip('handshake', '手机直播服务响应', 'iPhone 未通过 USB 识别')
      return finish()
    }

    if (activeStatus?.startedAt && activeStatus.transport === targetTransport(target)) {
      skip('forward', 'iproxy 转发启动', '直播正在使用 iPhone 连接，沿用当前连接状态')
      add('port', '本机转发端口连通', activeStatus.receiverConnected ? 'passed' : 'failed', activeStatus.receiverConnected ? '当前转发端口已连通' : diagnosticDetail(activeStatus))
      add('handshake', '手机直播服务响应', activeStatus.controlReady ? 'passed' : 'failed', activeStatus.controlReady ? '手机已响应直播连接检测' : diagnosticDetail(activeStatus))
      skip('cleanup', '临时连接清理', '未创建临时连接')
      return finish()
    }

    const localPort = await run('forward', 'iproxy 转发启动', async () => {
      const port = await allocateLocalPort()
      const child = spawn(proxyBinary, [`${port}:${PHONE_LIVE_PORT}`, phoneId!], { stdio: 'ignore', windowsHide: true })
      try {
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(() => {
            child.kill('SIGTERM')
            reject(new Error('iproxy 启动超时'))
          }, 2_000)
          child.once('spawn', () => { clearTimeout(timer); resolve() })
          child.once('error', (error) => { clearTimeout(timer); reject(toolSafeError(error, proxyBinary)) })
        })
        return { value: { port, child }, detail: `iproxy 已启动，转发目标为手机端口 ${PHONE_LIVE_PORT}` }
      } catch (error) {
        await stopChild(child)
        throw error
      }
    })
    if (!localPort) {
      skip('port', '本机转发端口连通', 'iproxy 未能启动')
      skip('handshake', '手机直播服务响应', 'iproxy 未能启动')
      return finish()
    }
    let socket: Socket | null = null
    try {
      socket = await run('port', '本机转发端口连通', async () => ({
        value: await waitForLocalPort(localPort.port, localPort.child),
        detail: `本机端口 ${localPort.port} 可连接`,
      }))
      if (!socket) {
        skip('handshake', '手机直播服务响应', '本机转发端口不可用')
        return finish()
      }
      await run('handshake', '手机直播服务响应', async () => {
        await testPhoneService(socket!)
        return { value: true, detail: '手机已响应直播连接检测' }
      })
    } finally {
      socket?.destroy()
      const cleanupAt = Date.now()
      try {
        await stopChild(localPort.child)
        add('cleanup', '临时连接清理', 'passed', '临时 iPhone 转发已关闭', cleanupAt)
      } catch (error) {
        add('cleanup', '临时连接清理', 'failed', errorText(error), cleanupAt)
      }
    }
    return finish()
  }

  if (target === 'android-adb') {
    binary = bundledAdbBinary()
    if (!binary) {
      add('tools', 'ADB 工具', 'failed', '当前安装包未提供此电脑的 ADB 工具')
      skip('adb-server', 'ADB 服务响应', 'ADB 工具不可用')
      skip('device', '手机 USB 授权', 'ADB 工具不可用')
      skip('forward', 'ADB 端口转发', 'ADB 工具不可用')
      skip('port', '本机转发端口连通', 'ADB 工具不可用')
      skip('handshake', '手机直播服务响应', 'ADB 工具不可用')
      return finish()
    }
    const adbRunner = createAdbRunner(binary)
    runner = (args, signal) => adbRunner(args, signal).catch((error: unknown) => { throw toolSafeError(error, binary!) })
    add('tools', 'ADB 工具', 'passed', 'ADB 工具可用')
    const deviceOutput = await run('adb-server', 'ADB 服务响应', async () => ({
      value: await runner!(['devices', '-l']),
      detail: 'ADB 服务已响应',
    }))
    if (deviceOutput === null) {
      skip('device', '手机 USB 授权', 'ADB 服务未响应')
      skip('forward', 'ADB 端口转发', 'ADB 服务未响应')
      skip('port', '本机转发端口连通', 'ADB 服务未响应')
      skip('handshake', '手机直播服务响应', 'ADB 服务未响应')
      return finish()
    }
    const devices = await run('device', '手机 USB 授权', async () => {
      const found = parseAdbDevices(deviceOutput)
      if (found.length === 0) throw new Error('未检测到安卓手机，请开启 USB 调试并重新连接')
      if (found.length > 1) throw new Error('检测到多台安卓手机，请只保留一台连接')
      if (found[0].state === 'unauthorized') throw new Error('手机尚未授权 USB 调试，请在手机上确认授权')
      if (found[0].state !== 'device') throw new Error('手机连接状态异常，请重新连接 USB')
      return { value: found[0], detail: '手机已连接并授权 USB 调试' }
    })
    if (!devices) {
      skip('forward', 'ADB 端口转发', '手机未通过 USB 授权')
      skip('port', '本机转发端口连通', '手机未通过 USB 授权')
      skip('handshake', '手机直播服务响应', '手机未通过 USB 授权')
      return finish()
    }
    if (activeStatus?.startedAt && activeStatus.transport === targetTransport(target)) {
      skip('forward', 'ADB 端口转发', '直播正在使用 ADB 连接，沿用当前连接状态')
      add('port', '本机转发端口连通', activeStatus.receiverConnected ? 'passed' : 'failed', activeStatus.receiverConnected ? '当前转发端口已连通' : diagnosticDetail(activeStatus))
      add('handshake', '手机直播服务响应', activeStatus.controlReady ? 'passed' : 'failed', activeStatus.controlReady ? '手机已响应直播连接检测' : diagnosticDetail(activeStatus))
      skip('cleanup', '临时连接清理', '未创建临时连接')
      return finish()
    }
    let forward: AdbForward | null = null
    let socket: Socket | null = null
    try {
      forward = await run('forward', 'ADB 端口转发', async () => {
        try {
          const value = await createAdbForward(runner!, devices.serial)
          return { value, detail: `本机端口 ${value.port} 已转发到手机 ${PHONE_LIVE_PORT}` }
        } catch (error) {
          throw deviceSafeError(error, devices.serial)
        }
      })
      if (!forward) {
        skip('port', '本机转发端口连通', 'ADB 端口转发失败')
        skip('handshake', '手机直播服务响应', 'ADB 端口转发失败')
        return finish()
      }
      socket = await run('port', '本机转发端口连通', async () => ({
        value: await connectLocalPort(forward!.port, CONNECT_TIMEOUT_MS),
        detail: `本机端口 ${forward!.port} 可连接`,
      }))
      if (!socket) {
        skip('handshake', '手机直播服务响应', '本机转发端口不可用')
        return finish()
      }
      await run('handshake', '手机直播服务响应', async () => {
        await testPhoneService(socket!)
        return { value: true, detail: '手机已响应直播连接检测' }
      })
    } finally {
      socket?.destroy()
      const cleanupAt = Date.now()
      if (forward) {
        try {
          await removeAdbForward(runner!, forward)
          add('cleanup', '临时连接清理', 'passed', '临时 ADB 转发已关闭', cleanupAt)
        } catch (error) {
          add('cleanup', '临时连接清理', 'failed', deviceSafeError(error, forward.serial).message, cleanupAt)
        }
      } else skip('cleanup', '临时连接清理', '未创建临时转发')
    }
    return finish()
  }

  binary = bundledHdcBinary()
  if (!binary) {
    add('tools', 'HDC 工具', 'failed', '未找到 HDC 工具，请重新安装应用')
    skip('hdc-server', 'HDC 服务响应', 'HDC 工具不可用')
    skip('device', '鸿蒙 USB 授权', 'HDC 工具不可用')
    skip('forward', 'HDC 端口转发', 'HDC 工具不可用')
    skip('port', '本机转发端口连通', 'HDC 工具不可用')
    skip('handshake', '手机直播服务响应', 'HDC 工具不可用')
    return finish()
  }
  const hdcRunner = createHdcRunner(binary)
  runner = (args, signal) => hdcRunner(args, signal).catch((error: unknown) => { throw toolSafeError(error, binary!) })
  add('tools', 'HDC 工具', 'passed', 'HDC 工具可用')
  const targetOutput = await run('hdc-server', 'HDC 服务响应', async () => ({
    value: await runner!(['list', 'targets', '-v']),
    detail: 'HDC 服务已响应',
  }))
  if (targetOutput === null) {
    skip('device', '鸿蒙 USB 授权', 'HDC 服务未响应')
    skip('forward', 'HDC 端口转发', 'HDC 服务未响应')
    skip('port', '本机转发端口连通', 'HDC 服务未响应')
    skip('handshake', '手机直播服务响应', 'HDC 服务未响应')
    return finish()
  }
  const devices = await run('device', '鸿蒙 USB 授权', async () => {
    const found = parseHdcTargets(targetOutput)
    if (found.length === 0) throw new Error('未检测到鸿蒙手机，请开启开发者选项并重新连接')
    if (found.length > 1) throw new Error('检测到多台鸿蒙手机，请只保留一台连接')
    if (found[0].state === 'unauthorized') throw new Error('手机尚未授权调试，请在手机上确认授权')
    if (found[0].state !== 'device') throw new Error('手机连接状态异常，请重新连接 USB')
    return { value: found[0], detail: '鸿蒙手机已通过 USB 连接' }
  })
  if (!devices) {
    skip('forward', 'HDC 端口转发', '手机未通过 USB 识别')
    skip('port', '本机转发端口连通', '手机未通过 USB 识别')
    skip('handshake', '手机直播服务响应', '手机未通过 USB 识别')
    return finish()
  }
  if (activeStatus?.startedAt && activeStatus.transport === targetTransport(target)) {
    skip('forward', 'HDC 端口转发', '直播正在使用 HDC 连接，沿用当前连接状态')
    add('port', '本机转发端口连通', activeStatus.receiverConnected ? 'passed' : 'failed', activeStatus.receiverConnected ? '当前转发端口已连通' : diagnosticDetail(activeStatus))
    add('handshake', '手机直播服务响应', activeStatus.controlReady ? 'passed' : 'failed', activeStatus.controlReady ? '手机已响应直播连接检测' : diagnosticDetail(activeStatus))
    skip('cleanup', '临时连接清理', '未创建临时连接')
    return finish()
  }
  let forward: AdbForward | null = null
  let socket: Socket | null = null
  try {
    forward = await run('forward', 'HDC 端口转发', async () => {
      try {
        const value = await createHdcForward(runner!, devices.serial)
        return { value, detail: `本机端口 ${value.port} 已转发到手机 ${PHONE_LIVE_PORT}` }
      } catch (error) {
        throw deviceSafeError(error, devices.serial)
      }
    })
    if (!forward) {
      skip('port', '本机转发端口连通', 'HDC 端口转发失败')
      skip('handshake', '手机直播服务响应', 'HDC 端口转发失败')
      return finish()
    }
    socket = await run('port', '本机转发端口连通', async () => ({
      value: await connectLocalPort(forward!.port, CONNECT_TIMEOUT_MS),
      detail: `本机端口 ${forward!.port} 可连接`,
    }))
    if (!socket) {
      skip('handshake', '手机直播服务响应', '本机转发端口不可用')
      return finish()
    }
    await run('handshake', '手机直播服务响应', async () => {
      await testPhoneService(socket!)
      return { value: true, detail: '手机已响应直播连接检测' }
    })
  } finally {
    socket?.destroy()
    const cleanupAt = Date.now()
    if (forward) {
      try {
        await removeHdcForward(runner!, forward)
        add('cleanup', '临时连接清理', 'passed', '临时 HDC 转发已关闭', cleanupAt)
      } catch (error) {
        add('cleanup', '临时连接清理', 'failed', deviceSafeError(error, forward.serial).message, cleanupAt)
      }
    } else skip('cleanup', '临时连接清理', '未创建临时转发')
  }
  return finish()
}
