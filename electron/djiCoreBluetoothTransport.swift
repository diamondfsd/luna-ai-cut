import CoreBluetooth
import Foundation

private func emit(_ object: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: object, options: []) else { return }
  FileHandle.standardOutput.write(data)
  FileHandle.standardOutput.write(Data([0x0a]))
}

private func hexData(_ value: String) -> Data? {
  let compact = value.replacingOccurrences(of: " ", with: "")
  guard compact.count % 2 == 0 else { return nil }
  var data = Data(capacity: compact.count / 2)
  var index = compact.startIndex
  while index < compact.endIndex {
    let next = compact.index(index, offsetBy: 2)
    guard let byte = UInt8(String(compact[index..<next]), radix: 16) else { return nil }
    data.append(byte)
    index = next
  }
  return data
}

private func uuidText(_ value: CBUUID) -> String {
  value.uuidString.lowercased()
}

final class DjiCoreBluetoothBridge: NSObject, CBCentralManagerDelegate, CBPeripheralDelegate {
  private var central: CBCentralManager!
  private var peripheral: CBPeripheral?
  private var serviceUuid = ""
  private var writeUuid = ""
  private var notifyUuid = ""
  private var namePrefixes: [String] = []
  private var excludedNamePrefixes: [String] = []
  private var connectRequestId: String?
  private var armRequestId: String?
  private var writeCharacteristic: CBCharacteristic?
  private var armCharacteristic: CBCharacteristic?
  private var notifying = Set<String>()
  private var ready = false
  private var scanTimer: DispatchWorkItem?

  override init() {
    super.init()
    central = CBCentralManager(delegate: self, queue: nil)
  }

  func handle(_ request: [String: Any]) {
    let command = request["command"] as? String ?? ""
    let requestId = request["id"] as? String ?? ""
    switch command {
    case "connect":
      connect(requestId: requestId, request: request)
    case "arm":
      arm(requestId: requestId)
    case "write":
      write(requestId: requestId, request: request)
    case "close":
      close(requestId: requestId)
    default:
      respond(requestId, ok: false, message: "未知命令：\(command)")
    }
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    guard let requestId = connectRequestId else { return }
    guard central.state == .poweredOn else {
      respond(requestId, ok: false, code: "BLUETOOTH_UNAVAILABLE", message: stateText(central.state))
      connectRequestId = nil
      return
    }
    startScan()
  }

  func centralManager(_ central: CBCentralManager, didDiscover peripheral: CBPeripheral, advertisementData: [String: Any], rssi RSSI: NSNumber) {
    let localName = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? ""
    let name = peripheral.name ?? localName
    let candidate = name.lowercased()
    let matchesName = namePrefixes.isEmpty || namePrefixes.contains { candidate.hasPrefix($0.lowercased()) }
    let excluded = excludedNamePrefixes.contains { candidate.hasPrefix($0.lowercased()) }
    guard matchesName && !excluded else { return }

    central.stopScan()
    scanTimer?.cancel()
    self.peripheral = peripheral
    peripheral.delegate = self
    central.connect(peripheral, options: nil)
    emit(["event": "discovered", "name": name, "rssi": RSSI.intValue, "identifier": peripheral.identifier.uuidString])
  }

  func centralManager(_ central: CBCentralManager, didConnect peripheral: CBPeripheral) {
    peripheral.delegate = self
    peripheral.discoverServices([CBUUID(string: serviceUuid)])
  }

  func centralManager(_ central: CBCentralManager, didFailToConnect peripheral: CBPeripheral, error: Error?) {
    failConnect(error?.localizedDescription ?? "DJI BLE 连接失败")
  }

  func centralManager(_ central: CBCentralManager, didDisconnectPeripheral peripheral: CBPeripheral, error: Error?) {
    ready = false
    let message = error?.localizedDescription ?? "DJI BLE 已断开"
    emit(["event": "disconnected", "message": message])
    if let requestId = connectRequestId {
      respond(requestId, ok: false, code: "BLE_DISCONNECTED", message: message)
      connectRequestId = nil
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverServices error: Error?) {
    if let error {
      failConnect(error.localizedDescription)
      return
    }
    guard let service = peripheral.services?.first(where: { uuidText($0.uuid) == serviceUuid.lowercased() }) else {
      failConnect("未找到 DJI BLE 服务 \(serviceUuid)")
      return
    }
    peripheral.discoverCharacteristics(nil, for: service)
  }

  func peripheral(_ peripheral: CBPeripheral, didDiscoverCharacteristicsFor service: CBService, error: Error?) {
    if let error {
      failConnect(error.localizedDescription)
      return
    }
    guard let characteristics = service.characteristics else {
      failConnect("DJI BLE 服务没有特征")
      return
    }
    writeCharacteristic = characteristics.first { uuidText($0.uuid) == writeUuid.lowercased() }
    armCharacteristic = characteristics.first { uuidText($0.uuid) == notifyUuid.lowercased() }
    guard writeCharacteristic != nil, armCharacteristic != nil else {
      failConnect("未找到 DJI BLE 的 fff4/fff5 特征")
      return
    }

    let notifyCharacteristics = characteristics.filter {
      let uuid = uuidText($0.uuid)
      return uuid == notifyUuid.lowercased() || uuid == writeUuid.lowercased()
    }
    notifying = Set(notifyCharacteristics.map { uuidText($0.uuid) })
    if notifying.isEmpty {
      markReady()
      return
    }
    for characteristic in notifyCharacteristics {
      peripheral.setNotifyValue(true, for: characteristic)
    }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateNotificationStateFor characteristic: CBCharacteristic, error: Error?) {
    let uuid = uuidText(characteristic.uuid)
    if let error {
      failConnect("启用 DJI BLE 通知失败（\(uuid)）：\(error.localizedDescription)")
      return
    }
    notifying.remove(uuid)
    if notifying.isEmpty { markReady() }
  }

  func peripheral(_ peripheral: CBPeripheral, didUpdateValueFor characteristic: CBCharacteristic, error: Error?) {
    if let error {
      emit(["event": "notification-error", "characteristic": uuidText(characteristic.uuid), "message": error.localizedDescription])
      return
    }
    guard let value = characteristic.value else { return }
    emit(["event": "notification", "characteristic": uuidText(characteristic.uuid), "payloadHex": value.map { String(format: "%02x", $0) }.joined()])
  }

  func peripheral(_ peripheral: CBPeripheral, didWriteValueFor characteristic: CBCharacteristic, error: Error?) {
    guard let requestId = armRequestId else { return }
    armRequestId = nil
    if let error {
      respond(requestId, ok: false, code: "BLE_ARM_FAILED", message: error.localizedDescription)
    } else {
      respond(requestId, ok: true)
    }
  }

  private func connect(requestId: String, request: [String: Any]) {
    guard let service = request["serviceUuid"] as? String,
          let write = request["writeCharacteristicUuid"] as? String,
          let notify = request["notifyCharacteristicUuid"] as? String else {
      respond(requestId, ok: false, code: "INVALID_BLE_CONFIG", message: "缺少 DJI BLE 服务配置")
      return
    }
    serviceUuid = service
    writeUuid = write
    notifyUuid = notify
    namePrefixes = request["namePrefixes"] as? [String] ?? []
    excludedNamePrefixes = request["excludedNamePrefixes"] as? [String] ?? []
    guard central.state == .poweredOn else {
      connectRequestId = requestId
      return
    }
    connectRequestId = requestId
    ready = false
    central.stopScan()
    startScan()
  }

  private func startScan() {
    guard central.state == .poweredOn, connectRequestId != nil else { return }
    central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
    let timer = DispatchWorkItem { [weak self] in
      guard let self, self.connectRequestId != nil, !self.ready else { return }
      self.central.stopScan()
      self.failConnect("未发现匹配的 DJI BLE 设备")
    }
    scanTimer?.cancel()
    scanTimer = timer
    DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timer)
  }

  private func markReady() {
    guard !ready else { return }
    ready = true
    if let requestId = connectRequestId {
      respond(requestId, ok: true, event: "ready", name: peripheral?.name ?? "DJI")
      connectRequestId = nil
    }
  }

  private func arm(requestId: String) {
    guard ready, let peripheral, let characteristic = armCharacteristic else {
      respond(requestId, ok: false, code: "BLE_NOT_READY", message: "DJI BLE 尚未准备完成")
      return
    }
    armRequestId = requestId
    peripheral.writeValue(Data([0x01, 0x00]), for: characteristic, type: .withResponse)
  }

  private func write(requestId: String, request: [String: Any]) {
    guard ready, let peripheral, let characteristic = writeCharacteristic else {
      respond(requestId, ok: false, code: "BLE_NOT_READY", message: "DJI BLE 尚未准备完成")
      return
    }
    guard let payloadHex = request["payloadHex"] as? String, let data = hexData(payloadHex) else {
      respond(requestId, ok: false, code: "INVALID_PAYLOAD", message: "DUML 数据不是有效十六进制")
      return
    }
    peripheral.writeValue(data, for: characteristic, type: .withoutResponse)
    respond(requestId, ok: true)
  }

  private func close(requestId: String) {
    central.stopScan()
    scanTimer?.cancel()
    if let peripheral { central.cancelPeripheralConnection(peripheral) }
    peripheral = nil
    ready = false
    respond(requestId, ok: true)
    exit(0)
  }

  private func failConnect(_ message: String) {
    central.stopScan()
    if let requestId = connectRequestId {
      respond(requestId, ok: false, code: "BLE_CONNECT_FAILED", message: message)
      connectRequestId = nil
    } else {
      emit(["event": "error", "message": message])
    }
  }

  private func respond(_ requestId: String, ok: Bool, code: String? = nil, message: String? = nil, event: String? = nil, name: String? = nil) {
    var result: [String: Any] = ["id": requestId, "ok": ok]
    if let code { result["code"] = code }
    if let message { result["message"] = message }
    if let event { result["event"] = event }
    if let name { result["name"] = name }
    emit(result)
  }

  private func stateText(_ state: CBManagerState) -> String {
    switch state {
    case .unknown: return "Bluetooth 状态未知"
    case .resetting: return "Bluetooth 正在重置"
    case .unsupported: return "当前 Mac 不支持 Bluetooth LE"
    case .unauthorized: return "应用没有 Bluetooth 权限"
    case .poweredOff: return "请打开系统 Bluetooth"
    case .poweredOn: return "Bluetooth 已开启"
    @unknown default: return "Bluetooth 状态异常"
    }
  }
}

let bridge = DjiCoreBluetoothBridge()
DispatchQueue.global(qos: .userInitiated).async {
  while let line = readLine(), let data = line.data(using: .utf8) {
    guard let object = try? JSONSerialization.jsonObject(with: data),
          let request = object as? [String: Any] else { continue }
    DispatchQueue.main.async { bridge.handle(request) }
  }
}

withExtendedLifetime(bridge) {
  RunLoop.main.run()
}
