import CoreWLAN
import Foundation

func printJson(_ object: [String: Any]) {
  do {
    let data = try JSONSerialization.data(withJSONObject: object, options: [.prettyPrinted, .sortedKeys])
    FileHandle.standardOutput.write(data)
  } catch {
    print("{\"success\":false,\"code\":\"JSON_ERROR\",\"message\":\"\\(error.localizedDescription)\"}")
  }
}

func result(success: Bool, message: String, data: Any? = nil, code: String? = nil) {
  var object: [String: Any] = [
    "success": success,
    "message": message
  ]
  if let data {
    object["data"] = data
  }
  if let code {
    object["code"] = code
  }
  printJson(object)
}

func argumentValue(_ name: String) -> String? {
  let args = CommandLine.arguments
  guard let index = args.firstIndex(of: name), index + 1 < args.count else {
    return nil
  }
  return args[index + 1]
}

func standardInputPassword() -> String? {
  let data = FileHandle.standardInput.readDataToEndOfFile()
  return String(data: data, encoding: .utf8)?.trimmingCharacters(in: .newlines)
}

func wifiInterface() -> CWInterface? {
  let client = CWWiFiClient.shared()
  if let interface = client.interface() {
    return interface
  }
  return client.interfaces()?.first
}

func securityText(_ security: CWSecurity) -> String {
  switch security {
  case .none:
    return "None"
  case .WEP:
    return "WEP"
  case .wpaPersonal:
    return "WPA Personal"
  case .wpaPersonalMixed:
    return "WPA Personal Mixed"
  case .wpa2Personal:
    return "WPA2 Personal"
  case .personal:
    return "Personal"
  case .dynamicWEP:
    return "Dynamic WEP"
  case .wpaEnterprise:
    return "WPA Enterprise"
  case .wpaEnterpriseMixed:
    return "WPA Enterprise Mixed"
  case .wpa2Enterprise:
    return "WPA2 Enterprise"
  case .enterprise:
    return "Enterprise"
  case .wpa3Personal:
    return "WPA3 Personal"
  case .wpa3Enterprise:
    return "WPA3 Enterprise"
  case .wpa3Transition:
    return "WPA3 Transition"
  case .OWE:
    return "OWE"
  case .oweTransition:
    return "OWE Transition"
  case .unknown:
    return "Unknown"
  @unknown default:
    return "Unknown"
  }
}

func networkSecurityText(_ network: CWNetwork) -> String {
  let candidates: [(CWSecurity, String)] = [
    (.wpa3Transition, "WPA3 Transition"),
    (.oweTransition, "OWE Transition"),
    (.OWE, "OWE"),
    (.wpa3Personal, "WPA3 Personal"),
    (.wpa2Personal, "WPA2 Personal"),
    (.wpaPersonal, "WPA Personal"),
    (.wpaPersonalMixed, "WPA Personal Mixed"),
    (.personal, "Personal"),
    (.wpa3Enterprise, "WPA3 Enterprise"),
    (.wpa2Enterprise, "WPA2 Enterprise"),
    (.wpaEnterprise, "WPA Enterprise"),
    (.wpaEnterpriseMixed, "WPA Enterprise Mixed"),
    (.enterprise, "Enterprise"),
    (.dynamicWEP, "Dynamic WEP"),
    (.WEP, "WEP"),
    (.none, "None")
  ]
  let supported = candidates.filter { security, _ in network.supportsSecurity(security) }.map { _, label in label }
  return supported.isEmpty ? "Unknown" : supported.joined(separator: " / ")
}

func statusPayload(interface: CWInterface) -> [String: Any] {
  let ssid = interface.ssid()
  return [
    "platform": "darwin",
    "interfaceName": interface.interfaceName ?? NSNull(),
    "connected": ssid != nil,
    "ssid": ssid ?? NSNull(),
    "bssid": interface.bssid() ?? NSNull(),
    "signal": "\(interface.rssiValue()) dBm",
    "security": securityText(interface.security()),
    "ipAddress": NSNull(),
    "raw": [
      "powerOn": interface.powerOn(),
      "transmitRate": interface.transmitRate(),
      "noiseMeasurement": interface.noiseMeasurement()
    ]
  ]
}

func networkPayload(_ network: CWNetwork) -> [String: Any] {
  [
    "ssid": network.ssid ?? "",
    "bssid": network.bssid ?? NSNull(),
    "signal": "\(network.rssiValue) dBm",
    "security": networkSecurityText(network),
    "channel": network.wlanChannel != nil ? String(network.wlanChannel!.channelNumber) : NSNull(),
    "raw": [
      "noiseMeasurement": network.noiseMeasurement,
      "beaconInterval": network.beaconInterval,
      "ibss": network.ibss
    ]
  ]
}

func targetNetwork(interface: CWInterface, ssid: String, bssid: String?) throws -> CWNetwork? {
  let candidates = try interface.scanForNetworks(withSSID: ssid.data(using: .utf8))
  return candidates.first { network in
    guard let bssid, !bssid.isEmpty else {
      return true
    }
    return network.bssid?.caseInsensitiveCompare(bssid) == .orderedSame
  }
}

func waitForAssociation(interface: CWInterface, ssid: String, timeout: TimeInterval) -> Bool {
  let deadline = Date().addingTimeInterval(timeout)
  while Date() < deadline {
    if interface.ssid() == ssid {
      return true
    }
    Thread.sleep(forTimeInterval: 0.25)
  }
  return interface.ssid() == ssid
}

guard let command = CommandLine.arguments.dropFirst().first else {
  result(success: false, message: "缺少 CoreWLAN 命令", code: "COMMAND_REQUIRED")
  exit(0)
}

guard let interface = wifiInterface() else {
  result(success: false, message: "未找到 Wi-Fi 接口", code: "WIFI_INTERFACE_NOT_FOUND")
  exit(0)
}

do {
  switch command {
  case "status":
    result(success: true, message: "CoreWLAN 状态已刷新", data: statusPayload(interface: interface))

  case "scan":
    let networks = try interface.scanForNetworks(withSSID: nil)
      .map(networkPayload)
      .sorted { left, right in
        let leftSsid = left["ssid"] as? String ?? ""
        let rightSsid = right["ssid"] as? String ?? ""
        return leftSsid.localizedCaseInsensitiveCompare(rightSsid) == .orderedAscending
      }
    result(success: true, message: "CoreWLAN 扫描到 \(networks.count) 个 Wi-Fi", data: networks)

  case "connect":
    guard let ssid = argumentValue("--ssid"), !ssid.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
      result(success: false, message: "请输入 SSID", code: "SSID_REQUIRED")
      exit(0)
    }
    let password = argumentValue("--password") ?? (CommandLine.arguments.contains("--password-stdin") ? standardInputPassword() : nil)
    let bssid = argumentValue("--bssid")
    let skipSsidVerification = CommandLine.arguments.contains("--skip-ssid-verification")
    let retryDelays: [TimeInterval] = [0, 0.5, 1.0]
    var lastMessage = "未扫描到目标 Wi-Fi：\(ssid)"

    for (attempt, delay) in retryDelays.enumerated() {
      if delay > 0 {
        interface.disassociate()
        Thread.sleep(forTimeInterval: delay)
      }

      do {
        guard let network = try targetNetwork(interface: interface, ssid: ssid, bssid: bssid) else {
          lastMessage = "未扫描到目标 Wi-Fi：\(ssid)"
          continue
        }

        try interface.associate(to: network, password: password)
        if skipSsidVerification || waitForAssociation(interface: interface, ssid: ssid, timeout: 3.5) {
          result(success: true, message: "CoreWLAN 已连接 \(ssid)", data: statusPayload(interface: interface))
          exit(0)
        }
        lastMessage = "CoreWLAN 连接请求未确认成功：当前 Wi-Fi 为 \(interface.ssid() ?? "未连接")"
      } catch {
        lastMessage = error.localizedDescription
      }

      if attempt < retryDelays.count - 1 {
        Thread.sleep(forTimeInterval: 0.5)
      }
    }
    result(
      success: false,
      message: "\(lastMessage)（CoreWLAN 已重试 \(retryDelays.count) 次）",
      data: statusPayload(interface: interface),
      code: "ASSOCIATION_NOT_CONFIRMED"
    )

  case "disconnect":
    interface.disassociate()
    result(success: true, message: "CoreWLAN 已断开当前 Wi-Fi", data: statusPayload(interface: interface))

  default:
    result(success: false, message: "未知 CoreWLAN 命令：\(command)", code: "UNKNOWN_COMMAND")
  }
} catch {
  result(success: false, message: error.localizedDescription, code: "COREWLAN_ERROR")
}
