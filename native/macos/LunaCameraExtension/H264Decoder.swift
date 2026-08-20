import Foundation
import CoreMedia
import VideoToolbox

final class H264Decoder {
    private var formatDescription: CMVideoFormatDescription?
    private var session: VTDecompressionSession?
    private(set) var width = 0
    private(set) var height = 0
    var onFrame: ((Data, Int, Int) -> Void)?

    deinit {
        if let session { VTDecompressionSessionInvalidate(session) }
    }

    func configure(_ payload: Data) throws {
        guard let object = try JSONSerialization.jsonObject(with: payload) as? [String: Any],
              let width = object["width"] as? Int, width > 0,
              let height = object["height"] as? Int, height > 0 else {
            throw H264DecoderError.invalidConfiguration
        }
        guard let csd0Value = object["csd0"] as? String,
              let csd1Value = object["csd1"] as? String,
              let csd0 = Data(base64Encoded: csd0Value),
              let csd1 = Data(base64Encoded: csd1Value),
              let sps = parameterSet(csd0, type: 7),
              let pps = parameterSet(csd1, type: 8) ?? parameterSet(csd0, type: 8) else {
            throw H264DecoderError.missingParameterSets
        }

        var description: CMVideoFormatDescription?
        var status: OSStatus = -1
        sps.withUnsafeBytes { spsBytes in
            pps.withUnsafeBytes { ppsBytes in
                var pointers: [UnsafePointer<UInt8>] = [
                    spsBytes.bindMemory(to: UInt8.self).baseAddress!,
                    ppsBytes.bindMemory(to: UInt8.self).baseAddress!,
                ]
                var sizes = [sps.count, pps.count]
                status = CMVideoFormatDescriptionCreateFromH264ParameterSets(
                    allocator: kCFAllocatorDefault,
                    parameterSetCount: 2,
                    parameterSetPointers: &pointers,
                    parameterSetSizes: &sizes,
                    nalUnitHeaderLength: 4,
                    formatDescriptionOut: &description
                )
            }
        }
        guard status == noErr, let description else { throw H264DecoderError.formatDescription(status) }

        if let session { VTDecompressionSessionInvalidate(session) }
        var callback = VTDecompressionOutputCallbackRecord(
            decompressionOutputCallback: Self.outputCallback,
            decompressionOutputRefCon: Unmanaged.passUnretained(self).toOpaque()
        )
        let attributes: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
            kCVPixelBufferWidthKey: width,
            kCVPixelBufferHeightKey: height,
            kCVPixelBufferIOSurfacePropertiesKey: [:],
        ]
        var nextSession: VTDecompressionSession?
        status = VTDecompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            formatDescription: description,
            decoderSpecification: nil,
            imageBufferAttributes: attributes as CFDictionary,
            outputCallback: &callback,
            decompressionSessionOut: &nextSession
        )
        guard status == noErr, let nextSession else { throw H264DecoderError.session(status) }
        self.formatDescription = description
        self.session = nextSession
        self.width = width
        self.height = height
    }

    func decode(_ payload: Data) {
        guard let formatDescription, let session else { return }
        let units = annexBUnits(payload)
        let avcc: Data
        if units.isEmpty {
            avcc = payload
        } else {
            var result = Data()
            for unit in units {
                var length = UInt32(unit.count).bigEndian
                withUnsafeBytes(of: &length) { result.append(contentsOf: $0) }
                result.append(unit)
            }
            avcc = result
        }
        guard !avcc.isEmpty else { return }

        var blockBuffer: CMBlockBuffer?
        var status = CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault,
            memoryBlock: nil,
            blockLength: avcc.count,
            blockAllocator: nil,
            customBlockSource: nil,
            offsetToData: 0,
            dataLength: avcc.count,
            flags: 0,
            blockBufferOut: &blockBuffer
        )
        guard status == kCMBlockBufferNoErr, let blockBuffer else { return }
        status = avcc.withUnsafeBytes { bytes in
            guard let baseAddress = bytes.baseAddress else { return OSStatus(kCMBlockBufferBadCustomBlockSourceErr) }
            return CMBlockBufferReplaceDataBytes(with: baseAddress, blockBuffer: blockBuffer, offsetIntoDestination: 0, dataLength: avcc.count)
        }
        guard status == kCMBlockBufferNoErr else { return }

        var sampleBuffer: CMSampleBuffer?
        var timing = CMSampleTimingInfo(duration: .invalid, presentationTimeStamp: CMClockGetTime(CMClockGetHostTimeClock()), decodeTimeStamp: .invalid)
        status = CMSampleBufferCreateReady(
            allocator: kCFAllocatorDefault,
            dataBuffer: blockBuffer,
            formatDescription: formatDescription,
            sampleCount: 1,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timing,
            sampleSizeEntryCount: 1,
            sampleSizeArray: [avcc.count],
            sampleBufferOut: &sampleBuffer
        )
        guard status == noErr, let sampleBuffer else { return }
        let flags = VTDecodeFrameFlags._EnableAsynchronousDecompression
        VTDecompressionSessionDecodeFrame(session, sampleBuffer: sampleBuffer, flags: flags, frameRefcon: nil, infoFlagsOut: nil)
    }

    private static let outputCallback: VTDecompressionOutputCallback = { refcon, _, status, _, imageBuffer, _, _ in
        guard status == noErr, let refcon, let imageBuffer else { return }
        Unmanaged<H264Decoder>.fromOpaque(refcon).takeUnretainedValue().handle(imageBuffer)
    }

    private func handle(_ imageBuffer: CVImageBuffer) {
        let pixelBuffer = imageBuffer as CVPixelBuffer
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }
        let rowBytes = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let width = CVPixelBufferGetWidth(pixelBuffer)
        var output = Data(count: width * height * 4)
        output.withUnsafeMutableBytes { destination in
            guard let destinationBase = destination.baseAddress else { return }
            for row in 0..<height {
                memcpy(destinationBase.advanced(by: row * width * 4), baseAddress.advanced(by: row * rowBytes), width * 4)
            }
        }
        onFrame?(output, width, height)
    }

    private func parameterSet(_ data: Data, type: UInt8) -> Data? {
        let units = annexBUnits(data)
        if let unit = units.first(where: { ($0.first ?? 0) & 0x1f == type }) { return unit }
        guard data.first == 1, data.count >= 8 else { return nil }
        let length = Int(data[6]) << 8 | Int(data[7])
        guard type == 7, length > 0, 8 + length <= data.count else { return nil }
        return data.subdata(in: 8..<(8 + length))
    }

    private func annexBUnits(_ data: Data) -> [Data] {
        let bytes = [UInt8](data)
        var starts: [(Int, Int)] = []
        var index = 0
        while index + 3 < bytes.count {
            if bytes[index] == 0, bytes[index + 1] == 0, bytes[index + 2] == 1 {
                starts.append((index, 3)); index += 3
            } else if bytes[index] == 0, bytes[index + 1] == 0, bytes[index + 2] == 0, bytes[index + 3] == 1 {
                starts.append((index, 4)); index += 4
            } else { index += 1 }
        }
        return starts.enumerated().compactMap { offset, start in
            let end = offset + 1 < starts.count ? starts[offset + 1].0 : bytes.count
            let unitStart = start.0 + start.1
            guard unitStart < end else { return nil }
            var unit = Array(bytes[unitStart..<end])
            while unit.last == 0 { unit.removeLast() }
            return unit.isEmpty ? nil : Data(unit)
        }
    }
}

enum H264DecoderError: Error, CustomStringConvertible {
    case invalidConfiguration
    case missingParameterSets
    case formatDescription(OSStatus)
    case session(OSStatus)

    var description: String {
        switch self {
        case .invalidConfiguration: return "invalid H.264 configuration"
        case .missingParameterSets: return "missing H.264 SPS/PPS"
        case .formatDescription(let status): return "H.264 format description failed: \(status)"
        case .session(let status): return "H.264 decoder session failed: \(status)"
        }
    }
}
