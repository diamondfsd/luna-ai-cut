import CoreBluetooth
import Foundation

func printJson(_ object: [String: Any]) {
  do {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data)
  } catch {
    print("{\"success\":false,\"code\":\"JSON_ERROR\",\"message\":\"\\(error.localizedDescription)\"}")
  }
}

final class BluetoothScanner: NSObject, CBCentralManagerDelegate {
  private var manager: CBCentralManager!
  private var devices: [String: [String: Any]] = [:]
  private var didStartScan = false
  private var didFinish = false
  private var state = "unknown"

  init(timeoutMs: Int) {
    super.init()
    manager = CBCentralManager(delegate: self, queue: nil)
    DispatchQueue.main.asyncAfter(deadline: .now() + .milliseconds(timeoutMs)) {
      self.finish()
    }
  }

  func centralManagerDidUpdateState(_ central: CBCentralManager) {
    state = stateText(central.state)
    guard central.state == .poweredOn else {
      return
    }
    guard !didStartScan else {
      return
    }
    didStartScan = true
    // 扫描所有设备，allowDuplicates = false
    central.scanForPeripherals(withServices: nil, options: [CBCentralManagerScanOptionAllowDuplicatesKey: false])
  }

  /// 将 manufacturerData 转为十六进制字符串
  private func hexString(from data: Data) -> String {
    return data.map { String(format: "%02x", $0) }.joined()
  }

  func centralManager(
    _ central: CBCentralManager,
    didDiscover peripheral: CBPeripheral,
    advertisementData: [String: Any],
    rssi RSSI: NSNumber
  ) {
    let localName = advertisementData[CBAdvertisementDataLocalNameKey] as? String ?? ""
    let serviceUuids = (advertisementData[CBAdvertisementDataServiceUUIDsKey] as? [CBUUID] ?? []).map { $0.uuidString }
    let manufacturerData = (advertisementData[CBAdvertisementDataManufacturerDataKey] as? Data)
    let txPower = advertisementData[CBAdvertisementDataTxPowerLevelKey] as? Int
    let isConnectable = advertisementData[CBAdvertisementDataIsConnectable] as? Bool

    let deviceName = peripheral.name ?? localName

    var device: [String: Any] = [
      "deviceId": peripheral.identifier.uuidString,
      "deviceName": deviceName,
      "localName": localName,
      "rssi": RSSI.intValue,
      "serviceUuids": serviceUuids,
    ]

    // manufacturerData hex dump
    if let mfr = manufacturerData {
      let hex = hexString(from: mfr)
      device["manufacturerData"] = hex
      // 同时做 UTF-8 文本解析，看看是否有 ##Insta360## 等标识
      if let text = String(data: mfr, encoding: .utf8) {
        device["manufacturerText"] = text
      }
    }

    if let tx = txPower { device["txPower"] = tx }
    if let conn = isConnectable { device["isConnectable"] = conn }

    devices[peripheral.identifier.uuidString] = device
  }

  private func stateText(_ state: CBManagerState) -> String {
    switch state {
    case .unknown: return "unknown"
    case .resetting: return "resetting"
    case .unsupported: return "unsupported"
    case .unauthorized: return "unauthorized"
    case .poweredOff: return "poweredOff"
    case .poweredOn: return "poweredOn"
    @unknown default: return "unknown"
    }
  }

  private func finish() {
    guard !didFinish else { return }
    didFinish = true
    manager.stopScan()

    let list = Array(devices.values).sorted {
      let aName = ($0["deviceName"] as? String ?? "").lowercased()
      let bName = ($1["deviceName"] as? String ?? "").lowercased()
      if aName != bName { return aName < bName }
      // 按信号强度降序
      let aRssi = $0["rssi"] as? Int ?? -100
      let bRssi = $1["rssi"] as? Int ?? -100
      return aRssi > bRssi
    }

    printJson([
      "success": true,
      "message": "CoreBluetooth 扫描到 \(list.count) 个设备",
      "data": list,
      "raw": [
        "state": state,
        "didStartScan": didStartScan
      ]
    ])
    exit(0)
  }
}

let timeoutArg = CommandLine.arguments.dropFirst().first.flatMap(Int.init) ?? 8000
let scanner = BluetoothScanner(timeoutMs: max(1000, timeoutArg))
withExtendedLifetime(scanner) {
  RunLoop.main.run()
}
