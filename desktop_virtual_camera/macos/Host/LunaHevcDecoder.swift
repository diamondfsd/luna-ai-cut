import Accelerate
import CoreMedia
import CoreVideo
import Foundation
import VideoToolbox

final class LunaHevcDecoder {
    private var formatDescription: CMVideoFormatDescription?
    private var session: VTDecompressionSession?
    private var sequence: UInt64 = 0

    private func trace(_ message: String) {
        let line = "\(Date()) \(message)\n"
        let url = URL(fileURLWithPath: "/tmp/luna-hevc.log")
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? Data(line.utf8).write(to: url, options: .atomic)
        }
    }

    func decodeAnnexB(_ accessUnit: Data, timestamp: UInt64) {
        trace("access unit bytes: \(accessUnit.count)")
        let nalUnits = Self.splitAnnexB(accessUnit)
        guard !nalUnits.isEmpty else { return }

        if formatDescription == nil {
            let parameterSets = nalUnits.filter { nalType($0) == 32 || nalType($0) == 33 || nalType($0) == 34 }
            guard parameterSets.count >= 3 else { return }
            let vps = parameterSets.first { nalType($0) == 32 }!
            let sps = parameterSets.first { nalType($0) == 33 }!
            let pps = parameterSets.first { nalType($0) == 34 }!
            var description: CMVideoFormatDescription?
            let status = vps.withUnsafeBytes { vpsBytes in
                sps.withUnsafeBytes { spsBytes in
                    pps.withUnsafeBytes { ppsBytes in
                        let pointers: [UnsafePointer<UInt8>] = [
                            vpsBytes.bindMemory(to: UInt8.self).baseAddress!,
                            spsBytes.bindMemory(to: UInt8.self).baseAddress!,
                            ppsBytes.bindMemory(to: UInt8.self).baseAddress!
                        ]
                        let sizes = [vps.count, sps.count, pps.count]
                        return pointers.withUnsafeBufferPointer { pointerBuffer in
                            sizes.withUnsafeBufferPointer { sizeBuffer in
                                CMVideoFormatDescriptionCreateFromHEVCParameterSets(
                                    allocator: kCFAllocatorDefault,
                                    parameterSetCount: 3,
                                    parameterSetPointers: pointerBuffer.baseAddress!,
                                    parameterSetSizes: sizeBuffer.baseAddress!,
                                    nalUnitHeaderLength: 4,
                                    extensions: nil,
                                    formatDescriptionOut: &description
                                )
                            }
                        }
                    }
                }
            }
            guard status == noErr, let description else {
                trace("parameter set error: \(status)")
                return
            }
            formatDescription = description
            createSession(for: description)
        }

        guard let formatDescription, let session else { return }
        var avcc = Data()
        for nal in nalUnits where nalType(nal) < 32 {
            var length = UInt32(nal.count).bigEndian
            withUnsafeBytes(of: &length) { avcc.append(contentsOf: $0) }
            avcc.append(nal)
        }
        guard !avcc.isEmpty else { return }

        var blockBuffer: CMBlockBuffer?
        guard CMBlockBufferCreateWithMemoryBlock(
            allocator: kCFAllocatorDefault,
            memoryBlock: nil,
            blockLength: avcc.count,
            blockAllocator: kCFAllocatorDefault,
            customBlockSource: nil,
            offsetToData: 0,
            dataLength: avcc.count,
            flags: 0,
            blockBufferOut: &blockBuffer
        ) == noErr, let blockBuffer else { return }
        let copyStatus = avcc.withUnsafeBytes { bytes in
            CMBlockBufferReplaceDataBytes(
                with: bytes.baseAddress!,
                blockBuffer: blockBuffer,
                offsetIntoDestination: 0,
                dataLength: avcc.count
            )
        }
        guard copyStatus == noErr else {
            trace("block copy error: \(copyStatus)")
            return
        }
        var sampleBuffer: CMSampleBuffer?
        var timing = CMSampleTimingInfo(
            duration: CMTime(value: 1, timescale: 30),
            presentationTimeStamp: CMTime(value: Int64(timestamp), timescale: 1_000_000),
            decodeTimeStamp: .invalid
        )
        guard CMSampleBufferCreateReady(
            allocator: kCFAllocatorDefault,
            dataBuffer: blockBuffer,
            formatDescription: formatDescription,
            sampleCount: 1,
            sampleTimingEntryCount: 1,
            sampleTimingArray: &timing,
            sampleSizeEntryCount: 1,
            sampleSizeArray: [avcc.count],
            sampleBufferOut: &sampleBuffer
        ) == noErr, let sampleBuffer else { return }
        let decodeStatus = VTDecompressionSessionDecodeFrame(
            session,
            sampleBuffer: sampleBuffer,
            flags: [],
            frameRefcon: Unmanaged.passUnretained(self).toOpaque(),
            infoFlagsOut: nil
        )
        if decodeStatus != noErr {
            trace("decode error: \(decodeStatus)")
        }
    }

    private func createSession(for description: CMVideoFormatDescription) {
        var callback = VTDecompressionOutputCallbackRecord(
            decompressionOutputCallback: outputCallback,
            decompressionOutputRefCon: Unmanaged.passUnretained(self).toOpaque()
        )
        let attributes: [CFString: Any] = [
            kCVPixelBufferPixelFormatTypeKey: kCVPixelFormatType_32BGRA,
            kCVPixelBufferIOSurfacePropertiesKey: [:]
        ]
        let status = VTDecompressionSessionCreate(
            allocator: kCFAllocatorDefault,
            formatDescription: description,
            decoderSpecification: nil,
            imageBufferAttributes: attributes as CFDictionary,
            outputCallback: &callback,
            decompressionSessionOut: &session
        )
        trace("session status: \(status)")
    }

    fileprivate func publish(_ pixelBuffer: CVPixelBuffer, timestamp: UInt64) {
        CVPixelBufferLockBaseAddress(pixelBuffer, .readOnly)
        defer { CVPixelBufferUnlockBaseAddress(pixelBuffer, .readOnly) }
        guard CVPixelBufferGetPixelFormatType(pixelBuffer) == kCVPixelFormatType_32BGRA,
              let baseAddress = CVPixelBufferGetBaseAddress(pixelBuffer) else { return }
        let sourceWidth = CVPixelBufferGetWidth(pixelBuffer)
        let sourceHeight = CVPixelBufferGetHeight(pixelBuffer)
        let sourceRowBytes = CVPixelBufferGetBytesPerRow(pixelBuffer)
        let outputWidth = 1280
        let outputHeight = 720
        let outputRowBytes = outputWidth * 4
        var output = Data(count: outputRowBytes * outputHeight)
        let scale = min(
            Double(outputWidth) / Double(sourceWidth),
            Double(outputHeight) / Double(sourceHeight)
        )
        let scaledWidth = max(1, min(outputWidth, Int((Double(sourceWidth) * scale).rounded())))
        let scaledHeight = max(1, min(outputHeight, Int((Double(sourceHeight) * scale).rounded())))
        let offsetX = (outputWidth - scaledWidth) / 2
        let offsetY = (outputHeight - scaledHeight) / 2

        output.withUnsafeMutableBytes { outputBytes in
            guard let outputBase = outputBytes.baseAddress else { return }
            memset(outputBase, 0, outputRowBytes * outputHeight)
            var sourceBuffer = vImage_Buffer(
                data: baseAddress,
                height: vImagePixelCount(sourceHeight),
                width: vImagePixelCount(sourceWidth),
                rowBytes: sourceRowBytes
            )
            var destinationBuffer = vImage_Buffer(
                data: outputBase.advanced(by: offsetY * outputRowBytes + offsetX * 4),
                height: vImagePixelCount(scaledHeight),
                width: vImagePixelCount(scaledWidth),
                rowBytes: outputRowBytes
            )
            vImageScale_ARGB8888(&sourceBuffer, &destinationBuffer, nil, vImage_Flags(kvImageHighQualityResampling))
        }
        sequence += 1
        do {
            try LunaCameraSharedFrameStore.publishBGRA(
                bytes: output,
                width: outputWidth,
                height: outputHeight,
                sequence: sequence,
                timestamp: timestamp
            )
            trace("published frame \(sequence)")
        } catch {
            trace("publish error: \(error)")
        }
    }

    private static func splitAnnexB(_ data: Data) -> [Data] {
        let bytes = Array(data)
        var starts: [(dataOffset: Int, prefixLength: Int)] = []
        var i = 0
        while i + 3 <= bytes.count {
            if i + 4 <= bytes.count,
               bytes[i] == 0, bytes[i + 1] == 0, bytes[i + 2] == 0, bytes[i + 3] == 1 {
                starts.append((i + 4, 4))
                i += 4
            } else if bytes[i] == 0, bytes[i + 1] == 0, bytes[i + 2] == 1 {
                starts.append((i + 3, 3))
                i += 3
            } else {
                i += 1
            }
        }
        return starts.enumerated().compactMap { index, start in
            let end = index + 1 < starts.count
                ? starts[index + 1].dataOffset - starts[index + 1].prefixLength
                : bytes.count
            guard start.dataOffset < end else { return nil }
            return Data(bytes[start.dataOffset..<end])
        }
    }

    private func nalType(_ nal: Data) -> Int { Int((nal.first ?? 0) >> 1) & 0x3F }
}

private func outputCallback(
    _ decompressionOutputRefCon: UnsafeMutableRawPointer?,
    _ sourceFrameRefCon: UnsafeMutableRawPointer?,
    _ status: OSStatus,
    _ infoFlags: VTDecodeInfoFlags,
    _ imageBuffer: CVImageBuffer?,
    _ presentationTimeStamp: CMTime,
    _ presentationDuration: CMTime
) {
    guard let refCon = decompressionOutputRefCon else { return }
    guard status == noErr, let imageBuffer else {
        decoderTrace("callback error: \(status)")
        return
    }
    let decoder = Unmanaged<LunaHevcDecoder>.fromOpaque(refCon).takeUnretainedValue()
    decoder.publish(imageBuffer, timestamp: UInt64(max(0, presentationTimeStamp.seconds * 1_000_000)))
}

private func decoderTrace(_ message: String) {
    let line = "\(Date()) \(message)\n"
    let url = URL(fileURLWithPath: "/tmp/luna-hevc.log")
    if let handle = try? FileHandle(forWritingTo: url) {
        handle.seekToEndOfFile()
        handle.write(Data(line.utf8))
        try? handle.close()
    } else {
        try? Data(line.utf8).write(to: url, options: .atomic)
    }
}
