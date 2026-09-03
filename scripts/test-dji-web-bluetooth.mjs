#!/usr/bin/env node
import assert from 'node:assert/strict'
import vm from 'node:vm'

import { DJI_MODEL_PROFILES, djiProfileForDevice } from '../electron/devices/dji/djiModels.ts'
import { buildDjiWebBluetoothAvailabilityScript, buildDjiWebBluetoothCleanupScript, buildDjiWebBluetoothConnectScript, matchesDjiBluetoothName } from '../electron/devices/dji/djiWebBluetoothScripts.ts'

class FakeEventTarget {
  listeners = new Map()

  addEventListener(type, listener) {
    const handlers = this.listeners.get(type) ?? new Set()
    handlers.add(listener)
    this.listeners.set(type, handlers)
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type, event = {}) {
    for (const listener of this.listeners.get(type) ?? []) listener({ ...event, target: event.target ?? this })
  }

  listenerCount(type) {
    return this.listeners.get(type)?.size ?? 0
  }
}

class FakeCharacteristic extends FakeEventTarget {
  notificationsStarted = false

  constructor(uuid, shouldFail = false) {
    super()
    this.uuid = uuid
    this.shouldFail = shouldFail
  }

  async startNotifications() {
    if (this.shouldFail) throw new Error('模拟通知启用失败')
    this.notificationsStarted = true
    return this
  }

  emitValue(bytes) {
    const backing = new Uint8Array([0xff, ...bytes, 0xee])
    this.value = new DataView(backing.buffer, 1, bytes.length)
    this.dispatch('characteristicvaluechanged', { target: this })
  }
}

class FakeDevice extends FakeEventTarget {
  disconnectCount = 0

  constructor(name, service, id = name) {
    super()
    this.id = id
    this.name = name
    this.service = service
    this.gatt = {
      connected: false,
      connect: async () => {
        this.gatt.connected = true
        return this.gatt
      },
      disconnect: () => {
        if (!this.gatt.connected) return
        this.gatt.connected = false
        this.disconnectCount += 1
        this.dispatch('gattserverdisconnected')
      },
      getPrimaryService: async (uuid) => {
        assert.equal(uuid, service.uuid)
        return service
      },
    }
  }
}

class FakeService {
  constructor(uuid, writeCharacteristic, notifyCharacteristic) {
    this.uuid = uuid
    this.characteristics = new Map([
      [writeCharacteristic.uuid, writeCharacteristic],
      [notifyCharacteristic.uuid, notifyCharacteristic],
    ])
  }

  async getCharacteristic(uuid) {
    const characteristic = this.characteristics.get(uuid)
    if (!characteristic) throw new Error(`模拟特征不存在：${uuid}`)
    return characteristic
  }
}

class FakeBluetooth {
  requestOptions = []

  constructor(grantedDevices, requestDevice, availability = true) {
    this.grantedDevices = grantedDevices
    this.requestDeviceResult = requestDevice
    this.availability = availability
  }

  async getAvailability() {
    return this.availability
  }

  async getDevices() {
    return this.grantedDevices
  }

  async requestDevice(options) {
    this.requestOptions.push(options)
    if (!this.requestDeviceResult) throw new Error('不应调用 requestDevice')
    return this.requestDeviceResult
  }
}

function harness(bluetooth) {
  const emitted = []
  return {
    emitted,
    window: {
      luna: { djiBluetooth: { emit: (event) => emitted.push(event) } },
      __lunaDjiBluetoothState: null,
    },
    navigator: { bluetooth },
  }
}

async function runConnect(profile, token, context) {
  return vm.runInNewContext(buildDjiWebBluetoothConnectScript(token, profile), context)
}

async function runAvailability(context) {
  return vm.runInNewContext(buildDjiWebBluetoothAvailabilityScript(), context)
}

function createDevice(profile, name, suffix = '', shouldFail = false) {
  const write = new FakeCharacteristic(profile.ble.writeCharacteristicUuid)
  const notify = new FakeCharacteristic(profile.ble.notifyCharacteristicUuid, shouldFail)
  const service = new FakeService(profile.ble.serviceUuid, write, notify)
  const device = new FakeDevice(name, service, `${name}-${suffix || 'id'}`)
  return { device, write, notify }
}

const pocket4 = DJI_MODEL_PROFILES.pocket4
const pocket4Pro = DJI_MODEL_PROFILES.pocket4pro

assert.equal(await runAvailability(harness(new FakeBluetooth([], null, true))), true, '应识别可用的蓝牙适配器')
assert.equal(await runAvailability(harness(new FakeBluetooth([], null, false))), false, '应识别不可用的蓝牙适配器')
assert.equal(await runAvailability({ navigator: { bluetooth: {} } }), null, '不支持状态探测时应返回未知')

assert.equal(djiProfileForDevice('dji-pocket-4').ble.serviceUuid, pocket4.ble.serviceUuid)
assert.equal(matchesDjiBluetoothName('OsmoPocket4-ACPT', pocket4), true)
assert.equal(matchesDjiBluetoothName('OsmoPocket4P-6E55', pocket4), false, 'Pocket 4 不应误选 Pocket 4 Pro')
assert.equal(matchesDjiBluetoothName('osmoPocket4-ACPT', pocket4), true, '设备名称匹配应忽略大小写')

const pro = createDevice(pocket4Pro, 'OsmoPocket4P-6E55', 'pro')
const normal = createDevice(pocket4, 'OsmoPocket4-ACPT', 'normal')
const grantedContext = harness(new FakeBluetooth([pro.device, normal.device], normal.device))
const grantedResult = await runConnect(pocket4, 'test-granted-token', grantedContext)
assert.equal(grantedResult.source, 'granted', '已有授权设备应跳过首次选择')
assert.equal(grantedResult.deviceName, normal.device.name)
assert.equal(grantedContext.navigator.bluetooth.requestOptions.length, 0)
assert.equal(normal.notify.notificationsStarted, true)
assert.equal(normal.write.notificationsStarted, true, '写入特征也应开启通知，保持与旧 Windows 实现一致')
assert.ok(grantedContext.emitted.some((event) => event.event === 'stage' && event.message === '找到已授权设备'))

normal.notify.emitValue([0x10, 0x20, 0x30])
const notification = grantedContext.emitted.find((event) => event.event === 'notification')
assert.ok(notification, `未收到通知：${JSON.stringify(grantedContext.emitted)}`)
assert.equal(notification.payloadHex, '102030', '通知应按 DataView 的有效范围转发为十六进制')
assert.equal(notification.characteristic, pocket4.ble.notifyCharacteristicUuid)

const requested = createDevice(pocket4, 'OsmoPocket4-New', 'requested')
const requestedBluetooth = new FakeBluetooth([], requested.device)
const requestedContext = harness(requestedBluetooth)
const requestedResult = await runConnect(pocket4, 'test-request-token', requestedContext)
assert.equal(requestedResult.source, 'request')
assert.deepEqual(JSON.parse(JSON.stringify(requestedBluetooth.requestOptions[0])), {
  filters: [{ namePrefix: 'OsmoPocket4' }],
  optionalServices: [pocket4.ble.serviceUuid],
})

const stale = createDevice(pocket4, 'OsmoPocket4-Stale', 'stale')
const staleBluetooth = new FakeBluetooth([stale.device], null)
const staleContext = harness(staleBluetooth)
await runConnect(pocket4, 'test-cleanup-token', staleContext)
assert.equal(stale.notify.listenerCount('characteristicvaluechanged'), 1)
const replacement = createDevice(pocket4, 'OsmoPocket4-Replacement', 'replacement')
staleBluetooth.grantedDevices = []
staleBluetooth.requestDeviceResult = replacement.device
await runConnect(pocket4, 'test-cleanup-token', staleContext)
assert.equal(stale.notify.listenerCount('characteristicvaluechanged'), 0, '重新连接前应移除旧通知监听')
assert.equal(stale.device.disconnectCount, 1, '重新连接前应断开旧 GATT')
vm.runInNewContext(buildDjiWebBluetoothCleanupScript('test-cleanup-token'), staleContext)
vm.runInNewContext(buildDjiWebBluetoothCleanupScript('test-cleanup-token'), staleContext)
assert.equal(staleContext.window.__lunaDjiBluetoothState, null, '清理脚本可重复执行且不会污染脚本作用域')

const broken = createDevice(pocket4, 'OsmoPocket4-Broken', 'broken', true)
const brokenContext = harness(new FakeBluetooth([], broken.device))
await assert.rejects(() => runConnect(pocket4, 'test-failure-token', brokenContext), /模拟通知启用失败/)
assert.equal(broken.device.disconnectCount, 1, 'GATT 初始化失败时应清理设备连接')
assert.equal(brokenContext.window.__lunaDjiBluetoothState, null)

console.log('DJI Web Bluetooth script tests passed')
