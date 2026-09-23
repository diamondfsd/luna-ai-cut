//___FILEHEADER___

import Foundation
import CoreMediaIO
import IOKit.audio
import os.log

@main
struct LunaCameraExtensionMain {
    static func main() {
        let source = LunaCameraProviderSource(clientQueue: nil)
        CMIOExtensionProvider.startService(provider: source.provider)
        RunLoop.main.run()
    }
}
import CoreMediaIO
import IOKit.audio
import os.log

let kWhiteStripeHeight: Int = 10
let kFrameRate: Int = 30

// MARK: -

class LunaCameraDeviceSource: NSObject, CMIOExtensionDeviceSource {

	private(set) var device: CMIOExtensionDevice!

	private var _streamSource: LunaCameraStreamSource!

	private var _streamingCounter: UInt32 = 0

	private var _timer: DispatchSourceTimer?

	private let _timerQueue = DispatchQueue(label: "timerQueue", qos: .userInteractive, attributes: [], autoreleaseFrequency: .workItem, target: .global(qos: .userInteractive))

	private var _videoDescriptions: [CMFormatDescription] = []

	private var _bufferPools: [CVPixelBufferPool] = []

	private var _bufferAuxAttributes: NSDictionary!

	private var _whiteStripeStartRow: UInt32 = 0

	private var _whiteStripeIsAscending: Bool = false

	private var _lastFrameBytes: Data?

	init(localizedName: String) {

		super.init()
		let deviceID = UUID() // replace this with your device UUID
		self.device = CMIOExtensionDevice(localizedName: localizedName, deviceID: deviceID, legacyDeviceID: nil, source: self)

		let dimensions: [(Int32, Int32)] = [(1280, 720), (720, 1280)]
		let streamFormats = dimensions.compactMap { width, height -> CMIOExtensionStreamFormat? in
			var description: CMFormatDescription?
			guard CMVideoFormatDescriptionCreate(allocator: kCFAllocatorDefault, codecType: kCVPixelFormatType_32BGRA, width: width, height: height, extensions: nil, formatDescriptionOut: &description) == noErr,
			      let description else { return nil }
			var pool: CVPixelBufferPool?
			let pixelBufferAttributes: NSDictionary = [
				kCVPixelBufferWidthKey: width,
				kCVPixelBufferHeightKey: height,
				kCVPixelBufferPixelFormatTypeKey: description.mediaSubType,
				kCVPixelBufferIOSurfacePropertiesKey: [:] as NSDictionary
			]
			CVPixelBufferPoolCreate(kCFAllocatorDefault, nil, pixelBufferAttributes, &pool)
			guard let pool else { return nil }
			_videoDescriptions.append(description)
			_bufferPools.append(pool)
			return CMIOExtensionStreamFormat(formatDescription: description, maxFrameDuration: CMTime(value: 1, timescale: Int32(kFrameRate)), minFrameDuration: CMTime(value: 1, timescale: Int32(kFrameRate)), validFrameDurations: nil)
		}
		_bufferAuxAttributes = [kCVPixelBufferPoolAllocationThresholdKey: 5]

		let videoID = UUID() // replace this with your video UUID
		_streamSource = LunaCameraStreamSource(localizedName: "Luna Virtual Camera.Video", streamID: videoID, streamFormats: streamFormats, device: device)
		do {
			try device.addStream(_streamSource.stream)
		} catch let error {
			fatalError("Failed to add stream: \(error.localizedDescription)")
		}
	}

	var availableProperties: Set<CMIOExtensionProperty> {

		return [.deviceTransportType, .deviceModel]
	}

	func deviceProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionDeviceProperties {

		let deviceProperties = CMIOExtensionDeviceProperties(dictionary: [:])
		if properties.contains(.deviceTransportType) {
			deviceProperties.transportType = kIOAudioDeviceTransportTypeVirtual
		}
		if properties.contains(.deviceModel) {
			deviceProperties.model = "Luna Virtual Camera Model"
		}

		return deviceProperties
	}

	func setDeviceProperties(_ deviceProperties: CMIOExtensionDeviceProperties) throws {

		// Handle settable properties here.
	}

	func startStreaming() {

		guard !_bufferPools.isEmpty else {
			return
		}

		_streamingCounter += 1

		_timer = DispatchSource.makeTimerSource(flags: .strict, queue: _timerQueue)
		_timer!.schedule(deadline: .now(), repeating: 1.0 / Double(kFrameRate), leeway: .seconds(0))

		_timer!.setEventHandler {

			var err: OSStatus = 0
			let now = CMClockGetTime(CMClockGetHostTimeClock())
			let sharedFrame = LunaCameraSharedFrameStore.readLatestBGRA()
			// The client owns the active CMIO format. The source frame may have the
			// opposite orientation, so it must be fitted into this format instead
			// of changing the sample's format behind the client's back.
			let formatIndex = min(max(self._streamSource.activeFormatIndex, 0), self._bufferPools.count - 1)

			var pixelBuffer: CVPixelBuffer?
			err = CVPixelBufferPoolCreatePixelBufferWithAuxAttributes(kCFAllocatorDefault, self._bufferPools[formatIndex], self._bufferAuxAttributes, &pixelBuffer)
			if err != 0 {
				os_log(.error, "out of pixel buffers \(err)")
			}

			if let pixelBuffer = pixelBuffer {

				CVPixelBufferLockBaseAddress(pixelBuffer, [])

				var bufferPtr = CVPixelBufferGetBaseAddress(pixelBuffer)!
				let width = CVPixelBufferGetWidth(pixelBuffer)
				let height = CVPixelBufferGetHeight(pixelBuffer)
				let rowBytes = CVPixelBufferGetBytesPerRow(pixelBuffer)
				memset(bufferPtr, 0, rowBytes * height)

				if let sharedFrame,
				   sharedFrame.bytes.count == sharedFrame.width * 4 * sharedFrame.height {
					self._lastFrameBytes = sharedFrame.bytes
					let sourceWidth = sharedFrame.width
					let sourceHeight = sharedFrame.height
					let sourceRowBytes = sourceWidth * 4
					let scale = min(Double(width) / Double(sourceWidth), Double(height) / Double(sourceHeight))
					let scaledWidth = max(1, min(width, Int((Double(sourceWidth) * scale).rounded())))
					let scaledHeight = max(1, min(height, Int((Double(sourceHeight) * scale).rounded())))
					let offsetX = (width - scaledWidth) / 2
					let offsetY = (height - scaledHeight) / 2
					sharedFrame.bytes.withUnsafeBytes { bytes in
						guard let source = bytes.baseAddress else { return }
						for destinationY in 0..<scaledHeight {
							let sourceY = min(sourceHeight - 1, destinationY * sourceHeight / scaledHeight)
							let sourceRow = source.advanced(by: sourceY * sourceRowBytes)
							let destinationRow = bufferPtr.advanced(by: (offsetY + destinationY) * rowBytes + offsetX * 4)
							for destinationX in 0..<scaledWidth {
								let sourceX = min(sourceWidth - 1, destinationX * sourceWidth / scaledWidth)
								memcpy(destinationRow.advanced(by: destinationX * 4), sourceRow.advanced(by: sourceX * 4), 4)
							}
						}
					}
					if sharedFrame.sequence == 1 || sharedFrame.sequence.isMultiple(of: 30) {
						os_log(.info, "copied shared frame seq=%{public}llu source=%{public}dx%{public}d target=%{public}dx%{public}d format=%{public}d", sharedFrame.sequence, sourceWidth, sourceHeight, width, height, formatIndex)
					}
					CVPixelBufferUnlockBaseAddress(pixelBuffer, [])
					var sbuf: CMSampleBuffer!
					var timingInfo = CMSampleTimingInfo()
					timingInfo.presentationTimeStamp = CMClockGetTime(CMClockGetHostTimeClock())
					err = CMSampleBufferCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer, dataReady: true, makeDataReadyCallback: nil, refcon: nil, formatDescription: self._videoDescriptions[formatIndex], sampleTiming: &timingInfo, sampleBufferOut: &sbuf)
					if err == 0 {
						self._streamSource.stream.send(sbuf, discontinuity: [], hostTimeInNanoseconds: UInt64(timingInfo.presentationTimeStamp.seconds * Double(NSEC_PER_SEC)))
					}
					return
				}

				let whiteStripeStartRow = self._whiteStripeStartRow
				if self._whiteStripeIsAscending {
					self._whiteStripeStartRow = whiteStripeStartRow - 1
					self._whiteStripeIsAscending = self._whiteStripeStartRow > 0
				}
				else {
					self._whiteStripeStartRow = whiteStripeStartRow + 1
					self._whiteStripeIsAscending = self._whiteStripeStartRow >= (height - kWhiteStripeHeight)
				}
				bufferPtr += rowBytes * Int(whiteStripeStartRow)
				for _ in 0..<kWhiteStripeHeight {
					for _ in 0..<width {
						var white: UInt32 = 0xFFFFFFFF
						memcpy(bufferPtr, &white, MemoryLayout.size(ofValue: white))
						bufferPtr += MemoryLayout.size(ofValue: white)
					}
				}

				CVPixelBufferUnlockBaseAddress(pixelBuffer, [])

				var sbuf: CMSampleBuffer!
				var timingInfo = CMSampleTimingInfo()
				timingInfo.presentationTimeStamp = CMClockGetTime(CMClockGetHostTimeClock())
				err = CMSampleBufferCreateForImageBuffer(allocator: kCFAllocatorDefault, imageBuffer: pixelBuffer, dataReady: true, makeDataReadyCallback: nil, refcon: nil, formatDescription: self._videoDescriptions[formatIndex], sampleTiming: &timingInfo, sampleBufferOut: &sbuf)
				if err == 0 {
					self._streamSource.stream.send(sbuf, discontinuity: [], hostTimeInNanoseconds: UInt64(timingInfo.presentationTimeStamp.seconds * Double(NSEC_PER_SEC)))
				}
				os_log(.info, "video time \(timingInfo.presentationTimeStamp.seconds) now \(now.seconds) err \(err)")
			}
		}

		_timer!.setCancelHandler {
		}

		_timer!.resume()
	}

	func stopStreaming() {

		if _streamingCounter > 1 {
			_streamingCounter -= 1
		}
		else {
			_streamingCounter = 0
			if let timer = _timer {
				timer.cancel()
				_timer = nil
			}
		}
	}
}

// MARK: -

class LunaCameraStreamSource: NSObject, CMIOExtensionStreamSource {

	private(set) var stream: CMIOExtensionStream!

	let device: CMIOExtensionDevice

	private let _streamFormats: [CMIOExtensionStreamFormat]

	init(localizedName: String, streamID: UUID, streamFormats: [CMIOExtensionStreamFormat], device: CMIOExtensionDevice) {

		self.device = device
		self._streamFormats = streamFormats
		super.init()
		self.stream = CMIOExtensionStream(localizedName: localizedName, streamID: streamID, direction: .source, clockType: .hostTime, source: self)
	}

	var formats: [CMIOExtensionStreamFormat] {

		return _streamFormats
	}

	var activeFormatIndex: Int = 0 {

		didSet {
			if activeFormatIndex >= _streamFormats.count {
				os_log(.error, "Invalid index")
			}
		}
	}

	var availableProperties: Set<CMIOExtensionProperty> {

		return [.streamActiveFormatIndex, .streamFrameDuration]
	}

	func streamProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionStreamProperties {

		let streamProperties = CMIOExtensionStreamProperties(dictionary: [:])
		if properties.contains(.streamActiveFormatIndex) {
			streamProperties.activeFormatIndex = self.activeFormatIndex
		}
		if properties.contains(.streamFrameDuration) {
			let frameDuration = CMTime(value: 1, timescale: Int32(kFrameRate))
			streamProperties.frameDuration = frameDuration
		}

		return streamProperties
	}

	func setStreamProperties(_ streamProperties: CMIOExtensionStreamProperties) throws {

		if let activeFormatIndex = streamProperties.activeFormatIndex {
			self.activeFormatIndex = activeFormatIndex
		}
	}

	func authorizedToStartStream(for client: CMIOExtensionClient) -> Bool {

		// An opportunity to inspect the client info and decide if it should be allowed to start the stream.
		return true
	}

	func startStream() throws {

		guard let deviceSource = device.source as? LunaCameraDeviceSource else {
			fatalError("Unexpected source type \(String(describing: device.source))")
		}
		deviceSource.startStreaming()
	}

	func stopStream() throws {

		guard let deviceSource = device.source as? LunaCameraDeviceSource else {
			fatalError("Unexpected source type \(String(describing: device.source))")
		}
		deviceSource.stopStreaming()
	}
}

// MARK: -

class LunaCameraProviderSource: NSObject, CMIOExtensionProviderSource {

	private(set) var provider: CMIOExtensionProvider!

	private var deviceSource: LunaCameraDeviceSource!

	// CMIOExtensionProviderSource protocol methods (all are required)

	init(clientQueue: DispatchQueue?) {

		super.init()

		provider = CMIOExtensionProvider(source: self, clientQueue: clientQueue)
		deviceSource = LunaCameraDeviceSource(localizedName: "Luna Virtual Camera")

		do {
			try provider.addDevice(deviceSource.device)
		} catch let error {
			fatalError("Failed to add device: \(error.localizedDescription)")
		}
	}

	func connect(to client: CMIOExtensionClient) throws {

		// Handle client connect
	}

	func disconnect(from client: CMIOExtensionClient) {

		// Handle client disconnect
	}

	var availableProperties: Set<CMIOExtensionProperty> {

		// See full list of CMIOExtensionProperty choices in CMIOExtensionProperties.h
		return [.providerManufacturer]
	}

	func providerProperties(forProperties properties: Set<CMIOExtensionProperty>) throws -> CMIOExtensionProviderProperties {

		let providerProperties = CMIOExtensionProviderProperties(dictionary: [:])
		if properties.contains(.providerManufacturer) {
			providerProperties.manufacturer = "Luna"
		}
		return providerProperties
	}

	func setProviderProperties(_ providerProperties: CMIOExtensionProviderProperties) throws {

		// Handle settable properties here.
	}
}
