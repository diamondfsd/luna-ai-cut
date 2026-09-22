import AppKit
import SystemExtensions
import os.log

private let extensionIdentifier = "com.diamondfsd.luna.virtualcamera.host.extension"

final class AppDelegate: NSObject, NSApplicationDelegate, OSSystemExtensionRequestDelegate {
    private var activationRequest: OSSystemExtensionRequest?
    private var hevcReceiver: LunaTcpHevcReceiver?
    private let audioRenderer = LunaAudioRenderer()

    func applicationDidFinishLaunching(_ notification: Notification) {
        ProcessInfo.processInfo.disableAutomaticTermination("Luna virtual camera output is active")
        let decoder = LunaHevcDecoder()
        hevcReceiver = try? LunaTcpHevcReceiver(decoder: decoder, audioRenderer: audioRenderer)
        hevcReceiver?.start()
        let request = OSSystemExtensionRequest.activationRequest(
            forExtensionWithIdentifier: extensionIdentifier,
            queue: .main
        )
        request.delegate = self
        activationRequest = request
        OSSystemExtensionManager.shared.submitRequest(request)
    }

    func request(
        _ request: OSSystemExtensionRequest,
        actionForReplacingExtension existing: OSSystemExtensionProperties,
        withExtension ext: OSSystemExtensionProperties
    ) -> OSSystemExtensionRequest.ReplacementAction {
        .replace
    }

    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        os_log(.default, "Luna camera extension needs user approval")
    }

    func request(
        _ request: OSSystemExtensionRequest,
        didFinishWithResult result: OSSystemExtensionRequest.Result
    ) {
        os_log(.default, "Luna camera extension activation finished: %{public}@", String(describing: result))
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        os_log(.error, "Luna camera extension activation failed: %{public}@", error.localizedDescription)
    }

    func applicationWillTerminate(_ notification: Notification) {
        audioRenderer.stop()
    }
}

let application = NSApplication.shared
let delegate = AppDelegate()
application.delegate = delegate
application.setActivationPolicy(.accessory)
application.run()
