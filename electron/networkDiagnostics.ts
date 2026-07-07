import os from 'node:os'
import net from 'node:net'
import { spawn } from 'node:child_process'
import type { NetworkDiagnosticsResult } from '../src/shared/types'
import { logMainDebug } from './loggerService'

type CommandResult = {
  key: string
  command: string
  args: string[]
  success: boolean
  exitCode: number | null
  signal: NodeJS.Signals | null
  stdout: string
  stderr: string
  error?: string
  durationMs: number
}

type DiagnosticCommand = {
  key: string
  command: string
  args: string[]
  timeoutMs?: number
}

const CAMERA_HOST = '192.168.42.1'
const HTTP_PORT = 80
const CONTROL_PORT = 6666

function runCommand(item: DiagnosticCommand): Promise<CommandResult> {
  const start = Date.now()
  const timeoutMs = item.timeoutMs ?? 6000

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let finished = false

    const child = spawn(item.command, item.args, {
      shell: false,
      windowsHide: true,
    })

    const timer = setTimeout(() => {
      if (finished) return
      finished = true
      child.kill('SIGKILL')

      resolve({
        key: item.key,
        command: item.command,
        args: item.args,
        success: false,
        exitCode: null,
        signal: 'SIGKILL',
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: `timeout after ${timeoutMs}ms`,
        durationMs: Date.now() - start,
      })
    }, timeoutMs)

    child.stdout.on('data', data => {
      stdout += data.toString()
    })

    child.stderr.on('data', data => {
      stderr += data.toString()
    })

    child.on('error', err => {
      if (finished) return
      finished = true
      clearTimeout(timer)

      resolve({
        key: item.key,
        command: item.command,
        args: item.args,
        success: false,
        exitCode: null,
        signal: null,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        error: err.message,
        durationMs: Date.now() - start,
      })
    })

    child.on('close', (code, signal) => {
      if (finished) return
      finished = true
      clearTimeout(timer)

      resolve({
        key: item.key,
        command: item.command,
        args: item.args,
        success: code === 0,
        exitCode: code,
        signal,
        stdout: stdout.trim(),
        stderr: stderr.trim(),
        durationMs: Date.now() - start,
      })
    })
  })
}

function findCameraSubnetIp(): string | null {
  const interfaces = os.networkInterfaces()

  for (const list of Object.values(interfaces)) {
    for (const item of list ?? []) {
      if (
        item.family === 'IPv4' &&
        !item.internal &&
        item.address.startsWith('192.168.42.')
      ) {
        return item.address
      }
    }
  }

  return null
}

/**
 * 通过子网掩码匹配目标主机，找到需要绑定的本地地址。
 * 与 connectSocket 中的 resolveLocalAddress 逻辑一致。
 */
function resolveCameraLocalAddress(): string | null {
  const targetHost = CAMERA_HOST
  const parts = targetHost.split('.')
  if (parts.length !== 4 || parts.some((p) => !/^\d{1,3}$/.test(p))) return null

  const ip4toInt = (ip: string): number =>
    ip.split('.').reduce((acc, oct) => ((acc << 8) | parseInt(oct, 10)) >>> 0, 0)

  const target = ip4toInt(targetHost)
  for (const addrs of Object.values(os.networkInterfaces())) {
    if (!addrs) continue
    for (const a of addrs) {
      if (a.internal || a.family !== 'IPv4' || !a.netmask) continue
      if ((target & ip4toInt(a.netmask)) === (ip4toInt(a.address) & ip4toInt(a.netmask))) {
        return a.address
      }
    }
  }
  return null
}

function tcpCheck(params: {
  host: string
  port: number
  localAddress?: string
  timeoutMs?: number
}): Promise<{
  ok: boolean
  host: string
  port: number
  localAddress?: string
  code?: string
  error?: string
  durationMs: number
}> {
  const { host, port, localAddress, timeoutMs = 3000 } = params
  const start = Date.now()

  return new Promise((resolve) => {
    const socket = new net.Socket()
    let finished = false

    const done = (result: {
      ok: boolean
      code?: string
      error?: string
    }) => {
      if (finished) return
      finished = true
      socket.destroy()

      resolve({
        host,
        port,
        localAddress,
        durationMs: Date.now() - start,
        ...result,
      })
    }

    socket.setTimeout(timeoutMs)

    socket.once('connect', () => {
      done({ ok: true })
    })

    socket.once('timeout', () => {
      done({
        ok: false,
        code: 'TIMEOUT',
        error: `connect timeout after ${timeoutMs}ms`,
      })
    })

    socket.once('error', (err: NodeJS.ErrnoException) => {
      done({
        ok: false,
        code: err.code,
        error: err.message,
      })
    })

    socket.connect({
      host,
      port,
      localAddress,
    })
  })
}

function getMacCommands(): DiagnosticCommand[] {
  return [
    {
      key: 'wifi_ssid',
      command: 'networksetup',
      args: ['-getairportnetwork', 'en0'],
      timeoutMs: 5000,
    },
    {
      key: 'ifconfig_en0',
      command: 'ifconfig',
      args: ['en0'],
      timeoutMs: 5000,
    },
    {
      key: 'route_camera',
      command: 'route',
      args: ['get', CAMERA_HOST],
      timeoutMs: 5000,
    },
    {
      key: 'route_default',
      command: 'route',
      args: ['get', 'default'],
      timeoutMs: 5000,
    },
    {
      key: 'netstat_camera_subnet',
      command: 'sh',
      args: ['-c', `netstat -rn -f inet | grep 192.168.42 || true`],
      timeoutMs: 5000,
    },
    {
      key: 'arp_camera',
      command: 'arp',
      args: ['-n', CAMERA_HOST],
      timeoutMs: 5000,
    },
    {
      key: 'ping_camera',
      command: 'ping',
      args: ['-c', '3', '-W', '1000', CAMERA_HOST],
      timeoutMs: 7000,
    },
    {
      key: 'nc_http_80',
      command: 'nc',
      args: ['-vz', '-G', '3', CAMERA_HOST, String(HTTP_PORT)],
      timeoutMs: 6000,
    },
    {
      key: 'nc_control_6666',
      command: 'nc',
      args: ['-vz', '-G', '3', CAMERA_HOST, String(CONTROL_PORT)],
      timeoutMs: 6000,
    },
    {
      key: 'interfaces_summary',
      command: 'sh',
      args: ['-c', `ifconfig | grep -E "^(en|utun|awdl|llw|bridge|lo)[0-9]*:" || true`],
      timeoutMs: 5000,
    },
  ]
}

function getWindowsCommands(): DiagnosticCommand[] {
  return [
    {
      key: 'ipconfig_all',
      command: 'ipconfig',
      args: ['/all'],
      timeoutMs: 8000,
    },
    {
      key: 'route_print',
      command: 'route',
      args: ['print'],
      timeoutMs: 8000,
    },
    {
      key: 'arp_all',
      command: 'arp',
      args: ['-a'],
      timeoutMs: 5000,
    },
    {
      key: 'ping_camera',
      command: 'ping',
      args: ['-n', '3', CAMERA_HOST],
      timeoutMs: 7000,
    },
    {
      key: 'powershell_test_http_80',
      command: 'powershell',
      args: [
        '-NoProfile',
        '-Command',
        `Test-NetConnection ${CAMERA_HOST} -Port ${HTTP_PORT} | ConvertTo-Json -Compress`,
      ],
      timeoutMs: 10000,
    },
    {
      key: 'powershell_test_control_6666',
      command: 'powershell',
      args: [
        '-NoProfile',
        '-Command',
        `Test-NetConnection ${CAMERA_HOST} -Port ${CONTROL_PORT} | ConvertTo-Json -Compress`,
      ],
      timeoutMs: 10000,
    },
  ]
}

function getLinuxCommands(): DiagnosticCommand[] {
  return [
    {
      key: 'ip_addr',
      command: 'ip',
      args: ['addr'],
      timeoutMs: 5000,
    },
    {
      key: 'ip_route_camera',
      command: 'ip',
      args: ['route', 'get', CAMERA_HOST],
      timeoutMs: 5000,
    },
    {
      key: 'ip_route_all',
      command: 'ip',
      args: ['route'],
      timeoutMs: 5000,
    },
    {
      key: 'arp_camera',
      command: 'sh',
      args: ['-c', `arp -n ${CAMERA_HOST} || ip neigh show ${CAMERA_HOST} || true`],
      timeoutMs: 5000,
    },
    {
      key: 'ping_camera',
      command: 'ping',
      args: ['-c', '3', '-W', '1', CAMERA_HOST],
      timeoutMs: 7000,
    },
    {
      key: 'nc_http_80',
      command: 'nc',
      args: ['-vz', '-w', '3', CAMERA_HOST, String(HTTP_PORT)],
      timeoutMs: 6000,
    },
    {
      key: 'nc_control_6666',
      command: 'nc',
      args: ['-vz', '-w', '3', CAMERA_HOST, String(CONTROL_PORT)],
      timeoutMs: 6000,
    },
  ]
}

function getCommandsByPlatform(): DiagnosticCommand[] {
  if (process.platform === 'darwin') return getMacCommands()
  if (process.platform === 'win32') return getWindowsCommands()
  return getLinuxCommands()
}

export async function collectLunaNetworkDiagnostics(): Promise<NetworkDiagnosticsResult> {
  const startedAt = Date.now()
  const localCameraSubnetIp = findCameraSubnetIp()
  const resolvedLocalAddress = resolveCameraLocalAddress()
  const commands = getCommandsByPlatform()
  logMainDebug('[网络诊断] 收集诊断信息', { localCameraSubnetIp, resolvedLocalAddress, commandCount: commands.length })

  const [commandResults, tcpHttp, tcpControl] = await Promise.all([
    Promise.all(commands.map(runCommand)),
    tcpCheck({
      host: CAMERA_HOST,
      port: HTTP_PORT,
      localAddress: localCameraSubnetIp ?? undefined,
      timeoutMs: 3000,
    }),
    tcpCheck({
      host: CAMERA_HOST,
      port: CONTROL_PORT,
      localAddress: localCameraSubnetIp ?? undefined,
      timeoutMs: 3000,
    }),
  ])

  return {
    timestamp: new Date().toISOString(),
    durationMs: Date.now() - startedAt,

    app: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      v8: process.versions.v8,
    },

    camera: {
      host: CAMERA_HOST,
      httpPort: HTTP_PORT,
      controlPort: CONTROL_PORT,
    },

    network: {
      hostname: os.hostname(),
      localCameraSubnetIp,
      resolvedLocalAddress,
    },

    tcpChecks: {
      http80: tcpHttp,
      control6666: tcpControl,
    },

    commands: commandResults,
  }
}
