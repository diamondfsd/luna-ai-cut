export interface UsbDiagnosticDevice {
  deviceDescriptor: { idVendor: number; idProduct: number }
  busNumber: number
  deviceAddress: number
}

export function usbDeviceDetails(device: UsbDiagnosticDevice) {
  return {
    vendorId: `0x${device.deviceDescriptor.idVendor.toString(16).padStart(4, '0')}`,
    productId: `0x${device.deviceDescriptor.idProduct.toString(16).padStart(4, '0')}`,
    busNumber: device.busNumber,
    deviceAddress: device.deviceAddress,
  }
}

export function usbFailureMessage(error: unknown): string {
  const detail = error instanceof Error ? error.message : String(error)
  if (/LIBUSB_ERROR_NOT_SUPPORTED/i.test(detail)) return '无法访问手机 USB，请检查 USB 驱动'
  if (/LIBUSB_ERROR_ACCESS/i.test(detail)) return '无法访问手机 USB，请检查设备权限'
  if (/LIBUSB_ERROR_BUSY/i.test(detail)) return '手机 USB 被占用，请关闭其他手机连接软件'
  if (/LIBUSB_ERROR_NO_DEVICE/i.test(detail)) return '手机 USB 已断开，请重新连接'
  if (/LIBUSB_ERROR_TIMEOUT/i.test(detail)) return '手机 USB 响应超时，请重新连接'
  return '手机 USB 连接失败，请重新连接'
}

export class UsbDiagnosticError extends Error {
  readonly stage: string
  readonly originalError: unknown

  constructor(stage: string, originalError: unknown) {
    super(usbFailureMessage(originalError))
    this.stage = stage
    this.originalError = originalError
  }
}

export function usbErrorDetails(error: unknown) {
  const original = error instanceof UsbDiagnosticError ? error.originalError : error
  return {
    stage: error instanceof UsbDiagnosticError ? error.stage : '接收数据',
    error: original instanceof Error ? original.message : String(original),
    errno: original && typeof original === 'object' && 'errno' in original ? original.errno : undefined,
  }
}
