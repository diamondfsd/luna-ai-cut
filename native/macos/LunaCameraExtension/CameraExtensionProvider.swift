import Foundation
import CoreMediaIO
import CoreMedia
import IOKit.audio
import os.log

let lunaCameraWidth = 1280
let lunaCameraHeight = 720
let lunaCameraFrameRate = 30
let lunaCameraFramePort: UInt16 = 49998

final class LunaCameraDeviceSource: NSObject, CMIOExtensionDeviceSource {
    private(set) var device: CMIOExtensionDevice!
    private var streamSource: LunaCameraStreamSource!
    private let frameQueue = DispatchQueue(label: "com.diamondfsd.lunaaicut.camera.device", qos: .userInteractive)
    private var frameServer: FrameServer!
    private let decoder = H264Decoder()
    private var videoDescription: CMFormatDescription!
    private var bufferPool: CVPixelBufferPool!
    private var bufferAuxAttributes: NSDictionary = [kCVPixelBufferPoolAllocationThresholdKey: 5]
    private var streamingCounter: UInt32 = 0

    init(localizedName: String) {
        super.init()
        let deviceID = UUID(uuidString: "CF1ACD8E-2B9A-49DA-A0D2-6A11C2A6B80A")!
        device = CMIOExtensionDevice(localizedName: localizedName, deviceID: deviceID, legacyDeviceID: nil, source: self)

        CMVideoFormatDescriptionCreate(
            allocator: kCFAllocatorDefault,
            codecType: kCVPixelFormatType_32BGRA,
            width: Int32(lunaCameraWidth),
            height: Int32(lunaCameraHeight),
            extensions: nil,
            formatDescriptionOut: &videoDescription
        )
        let pixelBufferAttributes: NSDictionary = [
            kCVPixelBufferWidthKey: lunaCameraWidth,
            kCVPixelBufferHeightKey: lunaCameraHeight,
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
            kCVPixelBufferIOSurfacePropertiesKey: [:] as NSDictionary,
        ]
        CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, pixelBufferAttributes, &bufferPool)

        let streamFormat = CMIOExtensionStreamFormat(
            formatDescription: videoDescription,
            maxFrameDuration: CMTime(value: 1, timescale: Int32(lunaCameraFrameRate)),
            minFrameDuration: CMTime(value: 1, timescale: Int32(lunaCameraFrameRate)),
            validFrameDurations: nil
        )
        streamSource = LunaCameraStreamSource(
            localizedName: "Luna Camera Video",
            streamID: UUID(uuidString: "EC3A50AA-B1D6-45BF-BB79-2D71D7141B8B")!,
            streamFormat: streamFormat,
            device: device
        )
        do { try device.addStream(streamSource.stream) }
        catch { fatalError("failed to add Luna Camera stream: \(error)") }

        decoder.onFrame = { [weak self] data, width, height in
            self?.frameQueue.async { [weak self] in self?.submit(data: data, width: width, height: height) }
        }
        frameServer = FrameServer(port: lunaCameraFramePort) { [weak self] packet in
            self?.handle(packet)
        }
        do { try frameServer.start() }
        catch { os_log(.error, "Luna Camera frame server failed: %{public}@", String(describing: error)) }
    }

    deinit { frameServer.stop() }

    var availableProperties: Set<CMIOExtensionProperty> { [.deviceTransportType, .deviceModel] }

    func deviceProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionDeviceProperties {
        let result = CMIOExtensionDeviceProperties(dictionary: [:])
        if properties.contains(.deviceTransportType) { result.transportType = kIOAudioDeviceTransportTypeVirtual }
        if properties.contains(.deviceModel) { result.model = "Luna Camera Bridge" }
        return result
    }

    func setDeviceProperties(_ deviceProperties: CMIOExtensionDeviceProperties) throws {}

    func startStreaming() { streamingCounter += 1 }

    func stopStreaming() {
        if streamingCounter > 1 { streamingCounter -= 1 } else { streamingCounter = 0 }
    }

    private func handle(_ packet: CameraFramePacket) {
        frameQueue.async { [weak self] in
            guard let self else { return }
            switch packet.type {
            case 2:
                do { try decoder.configure(packet.payload) }
                catch { os_log(.error, "Luna Camera H.264 config failed: %{public}@", String(describing: error)) }
            case 3:
                decoder.decode(packet.payload)
            default:
                break
            }
        }
    }

    private func submit(data: Data, width: Int, height: Int) {
        guard streamingCounter > 0, let bufferPool, let videoDescription else { return }
        var pixelBuffer: CVPixelBuffer?
        guard CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, bufferPool, bufferAuxAttributes, &pixelBuffer) == kCVReturnSuccess,
              let pixelBuffer else { return }
        CVPixelBufferLockBaseAddress(pixelBuffer, [])
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, []) }
        guard let destination = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }
        let destinationStride = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let sourceStride = width * 4
        memset(destination, 0, destinationStride * lunaCameraHeight)
        let copyWidth = min(width, lunaCameraWidth) * 4
        let copyHeight = min(height, lunaCameraHeight)
        data.withUnsafeBytes { rawBuffer in
            guard let source = rawBuffer.baseAddress else { return }
            for row in 0..<copyHeight {
                memcpy(destination.advanced(by: row * destinationStride), source.advanced(by: row * sourceStride), copyWidth)
            }
        }
        var timing = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: Int32(lunaCameraFrameRate)),
            presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()),
            decodeTimeStamp: .invalid
        )
        var sampleBuffer: CMSampleBuffer?
        guard CMSampleBufferCreateForImageBuffer(
            allocator: kCFAllocatorDefault,
            imageBuffer: pixelBuffer,
            dataReady: true,
            makeDataReadyCallback: nil,
            refcon: nil,
            formatDescription: videoDescription,
            sampleTiming: &timing,
            sampleBufferOut: &sampleBuffer
        ) == noErr, let sampleBuffer else { return }
        streamSource.stream.send(
            sampleBuffer,
            discontinuity: [],
            hostTimeInNanoseconds: UInt64(timing.presentationTimeStamp.seconds * Double(NSEC_PER_SEC))
        )
    }
}

final class LunaCameraStreamSource: NSObject, CMIOExtensionStreamSource {
    private(set) var stream: CMIOExtensionStream!
    private let streamFormat: CMIOExtensionStreamFormat
    private let device: CMIOExtensionDevice

    init(localizedName: String, streamID: UUID, streamFormat: CMIOExtensionStreamFormat, device: CMIOExtensionDevice) {
        self.device = device
        self.streamFormat = streamFormat
        super.init()
        stream = CMIOExtensionStream(localizedName: localizedName, streamID: streamID, direction: .source, clockType: .hostTime, source: self)
    }

    var formats: [CMIOExtensionStreamFormat] { [streamFormat] }
    var activeFormatIndex = 0
    var availableProperties: Set<CMIOExtensionProperty> { [.streamActiveFormatIndex, .streamFrameDuration] }

    func streamProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionStreamProperties {
        let result = CMIOExtensionStreamProperties(dictionary: [:])
        if properties.contains(.streamActiveFormatIndex) { result.activeFormatIndex = 0 }
        if properties.contains(.streamFrameDuration) { result.frameDuration = CMTime(value: 1, timescale: Int32(lunaCameraFrameRate)) }
        return result
    }

    func setStreamProperties(_ streamProperties: CMIOExtensionStreamProperties) throws {
        if let index = streamProperties.activeFormatIndex { activeFormatIndex = index }
    }

    func authorizedToStartStream(for client: CMIOExtensionClient) -> Bool { true }

    func startStream() throws {
        guard let source = device.source as? LunaCameraDeviceSource else { return }
        source.startStreaming()
    }

    func stopStream() throws {
        guard let source = device.source as? LunaCameraDeviceSource else { return }
        source.stopStreaming()
    }
}

final class LunaCameraProviderSource: NSObject, CMIOExtensionProviderSource {
    private(set) var provider: CMIOExtensionProvider!
    private let deviceSource: LunaCameraDeviceSource

    init(clientQueue: DispatchQueue?) {
        deviceSource = LunaCameraDeviceSource(localizedName: "Luna Camera")
        super.init()
        provider = CMIOExtensionProvider(source: self, clientQueue: clientQueue)
        do { try provider.addDevice(deviceSource.device) }
        catch { fatalError("failed to add Luna Camera device: \(error)") }
    }

    func connect(to client: CMIOExtensionClient) throws {}
    func disconnect(from client: CMIOExtensionClient) {}
    var availableProperties: Set<CMIOExtensionProperty> { [.providerManufacturer] }

    func providerProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionProviderProperties {
        let result = CMIOExtensionProviderProperties(dictionary: [:])
        if properties.contains(.providerManufacturer) { result.manufacturer = "Luna AI Cut" }
        return result
    }

    func setProviderProperties(_ providerProperties: CMIOExtensionProviderProperties) throws {}
}
