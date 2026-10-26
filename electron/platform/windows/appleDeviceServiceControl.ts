import { checkAppleDeviceSupport, powershell } from './appleDeviceSupport.ts'
import type { AppleDeviceSupportState } from '../../../src/shared/types'

// The elevated command is fixed by the application; no renderer input is used.
export const START_APPLE_SERVICE = "$ErrorActionPreference = 'Stop'; $services = @(Get-Service | Where-Object { $_.Name -in @('Apple Mobile Device Service', 'AppleMobileDeviceService') -or $_.DisplayName -eq 'Apple Mobile Device Service' }); if ($services.Count -eq 0) { exit 2 }; foreach ($service in $services) { Start-Service -InputObject $service -ErrorAction Stop; $service.WaitForStatus('Running', [TimeSpan]::FromSeconds(15)) }"
const encoded = Buffer.from(START_APPLE_SERVICE, 'utf16le').toString('base64')
export const ELEVATED_START_APPLE_SERVICE = `$ErrorActionPreference = 'Stop'; try { $p = Start-Process -FilePath "$PSHOME\\powershell.exe" -Verb RunAs -WindowStyle Hidden -ArgumentList '-NoProfile -NonInteractive -EncodedCommand ${encoded}' -PassThru; if (-not $p.WaitForExit(30000)) { 'timeout' } else { [string]$p.ExitCode } } catch { if ($_.Exception.NativeErrorCode -eq 1223 -or $_.Exception.InnerException.NativeErrorCode -eq 1223) { 'cancelled' } else { throw } }`

export async function startAppleDeviceService(
  platform: string = process.platform,
  run: (command: string, elevated: boolean) => Promise<string> = (command, elevated) => powershell(command, undefined, elevated ? 45_000 : 20_000),
  check: () => Promise<AppleDeviceSupportState> = checkAppleDeviceSupport,
): Promise<void> {
  if (platform !== 'win32') throw new Error('当前系统无需启动苹果设备服务')
  const before = await check()
  if (before === 'ready') return
  if (before === 'missing') throw new Error('请先安装苹果设备驱动')
  try {
    try {
      await run(START_APPLE_SERVICE, false)
    } catch (directError) {
      const result = (await run(ELEVATED_START_APPLE_SERVICE, true)).trim()
      if (result === 'cancelled') throw new Error('已取消启动苹果设备服务')
      if (result !== '0') throw new Error(`苹果设备服务未能启动（${result}）\n${directError instanceof Error ? directError.message : String(directError)}`)
    }
    if (await check() !== 'ready') throw new Error('苹果设备服务仍不可用，请重启电脑后重试')
  } catch (error) {
    throw new Error(`无法启动苹果设备服务\n${error instanceof Error ? error.message : String(error)}`)
  }
}
