import Foundation
import CoreMediaIO

let providerSource = LunaCameraProviderSource(clientQueue: nil)
CMIOExtensionProvider.startService(provider: providerSource.provider)
CFRunLoopRun()
