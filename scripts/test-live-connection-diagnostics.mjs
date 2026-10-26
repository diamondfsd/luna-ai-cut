import assert from 'node:assert/strict'
import test from 'node:test'
import { IosProxyOutput } from '../electron/media/live-stream/iosConnectionDiagnostics.ts'
import { receiverDiagnostics } from '../electron/media/live-stream/mediaReceiverStatus.ts'
import { startAppleDeviceService, ELEVATED_START_APPLE_SERVICE } from '../electron/platform/windows/appleDeviceServiceControl.ts'

await test('another waiting transport cannot hide a failure; a working phone suppresses unrelated failures', () => {
  const android = { transport: 'usb-aoa', message: 'USB 无法访问', error: 'LIBUSB_ERROR_ACCESS', connectionDiagnostics: [], controlReady: false }
  const ios = { transport: 'ios-tcp', message: '等待手机', error: null, controlReady: false,
    connectionDiagnostics: [{ source: 'iPhone', message: '未识别手机', detail: 'No connected device found' }] }
  assert.equal(receiverDiagnostics([android, ios], ios).length, 2)
  const connected = { ...ios, controlReady: true, connectionDiagnostics: [] }
  assert.deepEqual(receiverDiagnostics([android, connected], connected), [])
})

await test('proxy failures survive split chunks and retain unknown stderr details', () => {
  const parser = new IosProxyOutput()
  assert.equal(parser.consume('waiting for connection\nConnecting to usb', false), null)
  const service = parser.consume('muxd failed, terminating.\r\n', false)
  assert.match(service.message, /苹果设备服务/)
  assert.equal(service.detail, 'Connecting to usbmuxd failed, terminating.')
  const missing = parser.consume('No connected device found, terminating.\n', false)
  assert.match(missing.message, /未识别到 iPhone/)
  assert.equal(parser.consume('unexpected native failure 0x1234\n', true).detail, 'unexpected native failure 0x1234')
})

await test('service control avoids changes on missing, ready and unsupported systems', async () => {
  const run = async () => assert.fail('must not launch a process')
  await startAppleDeviceService('win32', run, async () => 'ready')
  await assert.rejects(startAppleDeviceService('win32', run, async () => 'missing'), /先安装/)
  await assert.rejects(startAppleDeviceService('darwin', run), /无需/)
})

await test('service control requests elevation only after direct start fails and verifies readiness', async () => {
  const calls = []
  let checks = 0
  await startAppleDeviceService('win32', async (command, elevated) => {
    calls.push(elevated)
    if (!elevated) throw new Error('Access denied')
    assert.equal(command, ELEVATED_START_APPLE_SERVICE)
    assert.ok(command.includes('$PSHOME\\powershell.exe'))
    return '0'
  }, async () => ++checks === 1 ? 'stopped' : 'ready')
  assert.deepEqual(calls, [false, true])
  await assert.rejects(startAppleDeviceService('win32', async () => '', async () => 'stopped'), /仍不可用/)
})

await test('cancelled authorization, failed and timed out service starts remain visible failures', async () => {
  for (const result of ['cancelled', '2', 'timeout']) {
    await assert.rejects(startAppleDeviceService('win32', async (_command, elevated) => {
      if (!elevated) throw new Error('Access denied')
      return result
    }, async () => 'stopped'), result === 'cancelled' ? /已取消/ : /未能启动/)
  }
})
