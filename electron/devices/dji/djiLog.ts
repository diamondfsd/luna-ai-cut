import type { DjiMessage } from './djiBytes'

function redact(value: string): string {
  return value.replace(/((?:password|passwd|pwd)\s*[=:]\s*)[^\s,;}\]]+/gi, '$1[REDACTED]')
}
/** 统一 DJI 错误字段，便于群友回传日志后定位失败阶段。 */
export function djiErrorDetails(error: unknown): Record<string, unknown> {
  const value = error instanceof Error ? error : new Error(String(error))
  const details: Record<string, unknown> = {
    error: redact(value.message),
    errorName: value.name,
  }
  if ('code' in value && typeof value.code === 'string') details.code = value.code
  if (value.stack) details.stack = redact(value.stack)
  return details
}

/** 只记录 DUML 结构，不记录 BLE 返回内容或 Wi-Fi 密码。 */
export function djiMessageDetails(message: DjiMessage): Record<string, unknown> {
  return {
    target: `0x${message.target.toString(16).padStart(4, '0')}`,
    id: `0x${message.id.toString(16).padStart(4, '0')}`,
    flags: `0x${message.flags.toString(16).padStart(2, '0')}`,
    command: `0x${message.cmdSet.toString(16).padStart(2, '0')}/0x${message.cmdId.toString(16).padStart(2, '0')}`,
    payloadBytes: message.payload.length,
  }
}
