import type { LiveConnectionDiagnostic } from '../../../src/shared/types'

export function iosConnectionDiagnostic(detail: string): LiveConnectionDiagnostic {
  let message = 'iPhone 连接失败，请重新连接'
  if (/Connecting to usbmuxd failed/i.test(detail)) message = '无法连接苹果设备服务，请检查驱动和服务'
  else if (/No connected device found/i.test(detail)) message = '未识别到 iPhone，请解锁手机、确认信任并检查数据线'
  else if (/trust|pair|lockdown/i.test(detail)) message = 'iPhone 授权未完成，请解锁手机并确认信任'
  else if (/refused|reset|closed|timeout|timed out/i.test(detail)) message = '未收到 iPhone 画面，请打开 Luna 咔并连接相机'
  return { source: 'iPhone', message, detail: detail.slice(-2_000) }
}

// iproxy writes both operational messages and failures to stdout. Keep a
// bounded line buffer because process output can arrive in separate chunks.
export class IosProxyOutput {
  private pending = ''

  consume(chunk: string, stderr: boolean): LiveConnectionDiagnostic | null {
    this.pending = (this.pending + chunk).slice(-8_192)
    const lines = this.pending.split(/\r?\n/)
    this.pending = lines.pop() ?? ''
    let diagnostic: LiveConnectionDiagnostic | null = null
    for (const line of lines) {
      if (line.trim() && (stderr || /fail|error|No connected device|refused|reset|trust|pair|lockdown/i.test(line))) {
        diagnostic = iosConnectionDiagnostic(line.trim())
      }
    }
    if (this.pending.trim() && (stderr || /failed|error|No connected device/i.test(this.pending))) {
      diagnostic = iosConnectionDiagnostic(this.pending.trim())
    }
    return diagnostic
  }
}
