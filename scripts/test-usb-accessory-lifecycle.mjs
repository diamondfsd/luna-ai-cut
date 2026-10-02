import assert from 'node:assert/strict'

import { createUsbAccessoryShutdown } from '../electron/media/live-stream/usbAccessoryLifecycle.ts'
import { UsbDiagnosticError, usbErrorDetails, usbFailureMessage } from '../electron/media/live-stream/usbAoaDiagnostics.ts'
import { switchToUsbAccessory } from '../electron/media/live-stream/usbAoaSwitch.ts'
import { stateScore } from '../electron/media/live-stream/mediaReceiverStatus.ts'

const events = []
let finishPolling
let finishWrites
let finishRelease
const shutdown = createUsbAccessoryShutdown({
  stopPolling: () => new Promise((resolve) => {
    events.push('stop-poll')
    finishPolling = resolve
  }),
  waitForControlWrites: () => new Promise((resolve) => {
    events.push('wait-writes')
    finishWrites = resolve
  }),
  releaseInterface: () => new Promise((resolve) => {
    events.push('release')
    finishRelease = resolve
  }),
  closeDevice: () => events.push('close'),
})

const first = shutdown()
const second = shutdown()
assert.equal(first, second)
assert.deepEqual(events, ['stop-poll'])
finishPolling()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.deepEqual(events, ['stop-poll', 'wait-writes'])
finishWrites()
await new Promise((resolve) => setTimeout(resolve, 0))
assert.deepEqual(events, ['stop-poll', 'wait-writes', 'release'])
finishRelease()
await first
assert.deepEqual(events, ['stop-poll', 'wait-writes', 'release', 'close'])

console.info('USB accessory shutdown ordering checks passed')

const driverError = Object.assign(new Error('LIBUSB_ERROR_NOT_SUPPORTED'), { errno: -12 })
assert.match(usbFailureMessage(driverError), /驱动/)
assert.deepEqual(usbErrorDetails(new UsbDiagnosticError('打开配件设备', driverError)), {
  stage: '打开配件设备', error: 'LIBUSB_ERROR_NOT_SUPPORTED', errno: -12,
})
const status = { deviceLabel: null, deviceDetectionUnavailable: false }
assert.ok(stateScore({ ...status, state: 'error' }) > stateScore({ ...status, state: 'waiting', deviceDetectionUnavailable: true, deviceLabel: 'iPhone' }))
assert.ok(stateScore({ ...status, state: 'connected' }) > stateScore({ ...status, state: 'error' }))

const switchEvents = []
const device = {
  open: () => switchEvents.push('open'),
  close: () => switchEvents.push('close'),
  controlTransfer: (_requestType, request, _value, index, _data, callback) => {
    switchEvents.push([request, index])
    callback(null, request === 51 ? Buffer.from([2, 0]) : undefined)
  },
}
assert.equal(await switchToUsbAccessory(device, () => true, (version) => switchEvents.push(['supported', version])), true)
assert.deepEqual(switchEvents, ['open', [51, 0], ['supported', 2], [52, 0], [52, 1], [52, 2], [52, 3], [52, 4], [52, 5], [53, 0], 'close'])
switchEvents.length = 0
await assert.rejects(switchToUsbAccessory({
  ...device,
  controlTransfer: (_requestType, _request, _value, _index, _data, callback) => callback(driverError),
}, () => true, () => assert.fail('failed query must not mark device supported')), (error) => {
  assert.equal(error.stage, '查询配件协议')
  assert.equal(error.originalError, driverError)
  return true
})
assert.deepEqual(switchEvents, ['open', 'close'])
switchEvents.length = 0
await assert.rejects(switchToUsbAccessory({ ...device, open: () => { throw driverError } }, () => true, () => {}), { stage: '打开原始设备' })
assert.deepEqual(switchEvents, [])
await assert.rejects(switchToUsbAccessory({
  ...device,
  controlTransfer: (requestType, request, value, index, data, callback) => {
    if (request === 53) callback(new Error('LIBUSB_ERROR_TIMEOUT'))
    else device.controlTransfer(requestType, request, value, index, data, callback)
  },
}, () => true, () => {}), { stage: '请求切换配件模式' })
assert.equal(switchEvents.at(-1), 'close')
switchEvents.length = 0
assert.equal(await switchToUsbAccessory(device, () => false, () => assert.fail('stopped receiver must not switch')), false)
assert.deepEqual(switchEvents, ['open', [51, 0], 'close'])
console.info('USB diagnostics, switch failure cleanup and transport error visibility checks passed')
