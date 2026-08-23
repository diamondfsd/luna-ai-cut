import AppKit
import CoreMotion
import Foundation
import Network

private func nowMs() -> Int {
  Int(Date().timeIntervalSince1970 * 1_000)
}

final class MotionBridge {
  private let connection: NWConnection
  private let queue = DispatchQueue(label: "com.luna.aicut.mac-airpods-demo.bridge")
  var onReady: (() -> Void)?
  var onClosed: (() -> Void)?

  init(port: UInt16) {
    connection = NWConnection(host: "127.0.0.1", port: NWEndpoint.Port(rawValue: port)!, using: .tcp)
  }

  func start() {
    connection.stateUpdateHandler = { [weak self] state in
      switch state {
      case .ready:
        DispatchQueue.main.async { self?.onReady?() }
        self?.receiveNext()
      case .failed, .cancelled:
        DispatchQueue.main.async { self?.onClosed?() }
      default:
        break
      }
    }
    connection.start(queue: queue)
  }

  func send(_ object: [String: Any]) {
    guard JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object) else { return }
    var line = data
    line.append(0x0a)
    connection.send(content: line, completion: .contentProcessed { _ in })
  }

  private func receiveNext() {
    connection.receive(minimumIncompleteLength: 1, maximumLength: 1_024) { [weak self] _, _, isComplete, error in
      guard let self else { return }
      if isComplete || error != nil {
        DispatchQueue.main.async { self.onClosed?() }
        return
      }
      self.receiveNext()
    }
  }

  func close() {
    connection.cancel()
  }
}

final class MotionController: NSObject, CMHeadphoneMotionManagerDelegate {
  private let bridge: MotionBridge
  private let manager = CMHeadphoneMotionManager()
  private var started = false
  private var motionTimer: Timer?

  init(port: UInt16) {
    bridge = MotionBridge(port: port)
    super.init()
    manager.delegate = self
    bridge.onReady = { [weak self] in self?.startServices() }
    bridge.onClosed = { [weak self] in self?.terminate() }
  }

  func start() {
    bridge.start()
  }

  private func startServices() {
    manager.startConnectionStatusUpdates()
    if manager.isDeviceMotionAvailable {
      startDeviceMotion()
    } else {
      emitStatus(connected: false, available: false, error: "没有检测到支持头部运动的 AirPods，或尚未连接。")
    }
  }

  private func startDeviceMotion() {
    guard !started else { return }
    started = true
    emitStatus(connected: true, available: true)
    manager.startDeviceMotionUpdates()
    motionTimer = Timer.scheduledTimer(withTimeInterval: 0.05, repeats: true) { [weak self] _ in
      guard let self, let motion = self.manager.deviceMotion else { return }
      self.bridge.send([
        "type": "motion",
        "source": "airpods",
        "at": nowMs(),
        "x": motion.rotationRate.x,
        "y": motion.rotationRate.y,
        "z": motion.rotationRate.z,
        "roll": motion.attitude.roll,
        "pitch": motion.attitude.pitch,
        "yaw": motion.attitude.yaw,
      ])
    }
  }

  private func emitStatus(connected: Bool, available: Bool, error: String? = nil) {
    var payload: [String: Any] = [
      "type": "status",
      "source": "airpods",
      "connected": connected,
      "available": available,
      "at": nowMs(),
    ]
    if let error { payload["error"] = error }
    bridge.send(payload)
  }

  private func terminate() {
    motionTimer?.invalidate()
    motionTimer = nil
    manager.stopDeviceMotionUpdates()
    manager.stopConnectionStatusUpdates()
    bridge.close()
    NSApp.terminate(nil)
  }

  func headphoneMotionManagerDidConnect(_ manager: CMHeadphoneMotionManager) {
    emitStatus(connected: true, available: manager.isDeviceMotionAvailable)
    if manager.isDeviceMotionAvailable { startDeviceMotion() }
  }

  func headphoneMotionManagerDidDisconnect(_ manager: CMHeadphoneMotionManager) {
    manager.stopDeviceMotionUpdates()
    motionTimer?.invalidate()
    motionTimer = nil
    started = false
    emitStatus(connected: false, available: false)
  }
}

let port = UInt16(CommandLine.arguments.dropFirst().first.flatMap(Int.init) ?? 8788)
let application = NSApplication.shared
application.setActivationPolicy(.prohibited)
let controller = MotionController(port: port)
controller.start()
application.run()
