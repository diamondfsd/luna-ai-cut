import Foundation
import SystemExtensions
import Darwin

let cameraExtensionIdentifier = "com.diamondfsd.lunaaicut.camera"

final class InstallerDelegate: NSObject, OSSystemExtensionRequestDelegate {
    func requestNeedsUserApproval(_ request: OSSystemExtensionRequest) {
        print("Luna Camera 需要在系统设置中批准 Camera Extension。")
        fflush(stdout)
    }

    func request(_ request: OSSystemExtensionRequest, actionForReplacingExtension existing: OSSystemExtensionProperties, withExtension ext: OSSystemExtensionProperties) -> OSSystemExtensionRequest.ReplacementAction {
        print("正在更新 Luna Camera Extension。")
        return .replace
    }

    func request(_ request: OSSystemExtensionRequest, didFinishWithResult result: OSSystemExtensionRequest.Result) {
        print("Luna Camera Extension 激活请求完成：\(result)")
        fflush(stdout)
        exit(0)
    }

    func request(_ request: OSSystemExtensionRequest, didFailWithError error: Error) {
        fputs("Luna Camera Extension 激活失败：\(error.localizedDescription)\n", stderr)
        fflush(stderr)
        exit(1)
    }
}

let delegate = InstallerDelegate()
let request = OSSystemExtensionRequest.activationRequest(forExtensionWithIdentifier: cameraExtensionIdentifier, queue: .main)
request.delegate = delegate
OSSystemExtensionManager.shared.submitRequest(request)
RunLoop.main.run()
