import { execFile } from 'node:child_process'
import { createConnection } from 'node:net'
import { join } from 'node:path'
import type { AppleDeviceSupportState } from '../../../src/shared/types'

type QueryService = () => Promise<'missing' | 'stopped' | 'running'>
type ProbeService = () => Promise<boolean>

const SERVICE_QUERY = "$services = @(Get-Service -ErrorAction Stop | Where-Object { $_.Name -like '*Apple*Mobile*Device*' -or $_.DisplayName -like '*Apple*Mobile*Device*' }); if ($services.Count -eq 0) { 'missing' } elseif ($services | Where-Object { $_.Status -eq 'Running' }) { 'running' } else { 'stopped' }"
const SIGNATURE_QUERY = "$signature = Get-AuthenticodeSignature -LiteralPath $env:LUNA_APPLE_DRIVER_PATH -ErrorAction Stop; @{ status = [string]$signature.Status; subject = [string]$signature.SignerCertificate.Subject } | ConvertTo-Json -Compress"

function powershell(command: string, env?: NodeJS.ProcessEnv): Promise<string> {
  const binary = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  return new Promise((resolve, reject) => {
    execFile(binary, ['-NoProfile', '-NonInteractive', '-Command', command], {
      windowsHide: true, timeout: 5_000, maxBuffer: 16_384, env,
    }, (error, stdout) => error ? reject(error) : resolve(stdout.trim()))
  })
}

async function queryService(): ReturnType<QueryService> {
  const result = await powershell(SERVICE_QUERY)
  if (result === 'missing' || result === 'stopped' || result === 'running') return result
  throw new Error('苹果设备服务检查结果无效')
}

function probeService(): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host: '127.0.0.1', port: 27015 })
    let finished = false
    const finish = (ready: boolean) => {
      if (finished) return
      finished = true
      socket.destroy()
      resolve(ready)
    }
    socket.setTimeout(1_200, () => finish(false))
    socket.once('connect', () => finish(true))
    socket.once('error', () => finish(false))
    socket.once('close', () => finish(false))
  })
}

export async function checkAppleDeviceSupport(
  platform: string = process.platform,
  query: QueryService = queryService,
  probe: ProbeService = probeService,
): Promise<AppleDeviceSupportState> {
  if (platform !== 'win32') return 'not-required'
  try {
    const state = await query()
    if (state !== 'running') return state
    return await probe() ? 'ready' : 'unavailable'
  } catch {
    return 'unavailable'
  }
}

export function validateAppleInstallerSignature(output: string): void {
  const signature = JSON.parse(output) as { status?: string; subject?: string }
  if (signature.status !== 'Valid' || !/(?:^|,\s*)(?:CN|O)=Apple Inc\.(?:,|$)/.test(signature.subject ?? '')) {
    throw new Error('驱动验证失败，请重新下载')
  }
}

export async function verifyAppleInstallerSignature(filePath: string): Promise<void> {
  try {
    validateAppleInstallerSignature(await powershell(SIGNATURE_QUERY, {
      ...process.env, LUNA_APPLE_DRIVER_PATH: filePath,
    }))
  } catch {
    throw new Error('驱动验证失败，请重新下载')
  }
}
