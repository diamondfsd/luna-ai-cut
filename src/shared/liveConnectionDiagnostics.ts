import type { AppleDeviceSupportState, LiveConnectionDiagnostic } from './types/liveStream'

export function appleSupportDiagnostic(state: AppleDeviceSupportState): LiveConnectionDiagnostic | null {
  if (state === 'missing') return {
    source: '苹果手机', message: '未安装苹果设备驱动', detail: 'Apple Mobile Device Service: missing', action: 'install-apple-driver',
  }
  if (state === 'stopped') return {
    source: '苹果手机', message: '苹果设备服务未启动', detail: 'Apple Mobile Device Service: stopped', action: 'start-apple-service',
  }
  if (state === 'unavailable') return {
    source: '苹果手机', message: '苹果设备服务不可用，请启动服务或重新安装驱动',
    detail: 'Apple Mobile Device Service: unavailable', action: 'start-apple-service',
  }
  return null
}

export function liveErrorMessage(detail: string): string {
  if (/LIBUSB_ERROR_BUSY/.test(detail)) return '手机连接被占用，请关闭其他手机连接软件'
  if (/LIBUSB_ERROR_ACCESS/.test(detail)) return '无法访问手机，请检查设备权限'
  if (/LIBUSB_ERROR_NOT_SUPPORTED/.test(detail)) return '无法访问手机，请检查 USB 驱动'
  if (/unauthorized|trust|pair|lockdown/i.test(detail)) return '请在手机上确认连接授权'
  if (/ECONN|timeout|timed out/i.test(detail)) return '连接失败，请检查手机连接后重试'
  return '操作失败，请查看错误详情'
}
