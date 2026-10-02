import type usb from 'usb'
import { UsbDiagnosticError } from './usbAoaDiagnostics.ts'

function controlTransfer(
  device: usb.Device,
  bmRequestType: number,
  bRequest: number,
  wIndex: number,
  dataOrLength: number | Buffer,
): Promise<Buffer | number | undefined> {
  return new Promise((resolve, reject) => {
    device.controlTransfer(bmRequestType, bRequest, 0, wIndex, dataOrLength,
      (error, data) => error ? reject(error) : resolve(data))
  })
}

export async function switchToUsbAccessory(
  device: usb.Device,
  isRunning: () => boolean,
  onSupported: (version: number) => void,
): Promise<boolean> {
  let stage = '打开原始设备'
  let opened = false
  device.timeout = 2_000
  try {
    device.open()
    opened = true
    stage = '查询配件协议'
    const protocol = await controlTransfer(device, 0xc0, 51, 0, 2)
    if (!isRunning() || !Buffer.isBuffer(protocol) || protocol.length < 2) return false
    const version = protocol.readUInt16LE(0)
    if (version < 1) return false
    onSupported(version)
    const strings = [
      'LunaKa',
      'Luna USB Video Demo',
      'Luna USB video output',
      '1.0',
      'https://motionbridge.local/usb-video',
      'LunaKa',
    ]
    for (let index = 0; index < strings.length; index += 1) {
      if (!isRunning()) return false
      stage = `发送配件信息 ${index}`
      await controlTransfer(device, 0x40, 52, index, Buffer.from(`${strings[index]}\0`, 'utf8'))
    }
    stage = '请求切换配件模式'
    if (isRunning()) await controlTransfer(device, 0x40, 53, 0, Buffer.alloc(0))
    return true
  } catch (error) {
    throw new UsbDiagnosticError(stage, error)
  } finally {
    if (opened) {
      try { device.close() } catch { /* Device may already be re-enumerating. */ }
    }
  }
}
