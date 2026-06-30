#!/usr/bin/env swift

import Foundation
import CoreGraphics
import ImageIO
import AVFoundation
import UniformTypeIdentifiers
import CoreMedia

// ============================================================
// Live Photo Maker Tool
// Takes a JPG + MOV pair and adds Apple Live Photo metadata
//
// ⚠️ 使用注意事项：
// 1. 先导入 JPG 到 Mac 照片应用（支持自动识别）
// 2. 再将 MOV "共享" 到 iPhone（AirDrop / iCloud）
// 3. iOS 通过文件名配对来识别 Live Photo
//
// 常见误区：将两个文件同时传输到 iPhone，照片应用不识别
// 正确流程：Mac 照片应用 → 导入 JPG → 再单独共享 MOV
// ============================================================

guard CommandLine.arguments.count >= 3 else {
    print("""
    用法: swift livetool.swift <input.jpg> <input.mov> [输出前缀]

    示例: swift livetool.swift photo.jpg video.mov
          → photo_live.jpg + photo_live.mov
    """)
    exit(1)
}

let inputJPG = URL(fileURLWithPath: CommandLine.arguments[1])
let inputMOV = URL(fileURLWithPath: CommandLine.arguments[2])

let filePrefix: String
if CommandLine.arguments.count >= 4 {
    filePrefix = CommandLine.arguments[3]
} else {
    let base = inputJPG.deletingPathExtension().lastPathComponent
    if let range = base.range(of: "_wm_") {
        filePrefix = String(base[..<range.lowerBound]) + "_live"
    } else {
        filePrefix = base + "_live"
    }
}

let outputJPG = URL(fileURLWithPath: "\(filePrefix).jpg")
let outputMOV = URL(fileURLWithPath: "\(filePrefix).mov")

let assetIdentifier = UUID().uuidString

print("📸 Live Photo Maker")
print("━━━━━━━━━━━━━━━━━━━━━━")
print("Asset Identifier: \(assetIdentifier)")
print("")
print("输入 JPG: \(inputJPG.path)")
print("输入 MOV: \(inputMOV.path)")
print("输出 JPG: \(outputJPG.path)")
print("输出 MOV: \(outputMOV.path)")
print("")

// MARK: - JPG Processing
func processJPG(input: URL, output: URL, identifier: String) -> Bool {
    guard let source = CGImageSourceCreateWithURL(input as CFURL, nil) else {
        print("❌ 无法读取 JPG 文件")
        return false
    }

    guard let image = CGImageSourceCreateImageAtIndex(source, 0, nil) else {
        print("❌ 无法解码 JPG 图像")
        return false
    }

    guard var props = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [AnyHashable: Any] else {
        print("❌ 无法读取 JPG 元数据")
        return false
    }

    // Add Apple MakerNotes with Live Photo pairing key
    // Key "17" is LivePhotoVideoIndex — the critical pairing UUID for Live Photos
    let makerApple: [String: Any] = [
        "17": identifier
    ]
    props[kCGImagePropertyMakerAppleDictionary] = makerApple

    guard let dest = CGImageDestinationCreateWithURL(output as CFURL, UTType.jpeg.identifier as CFString, 1, nil) else {
        print("❌ 无法创建输出 JPG")
        return false
    }

    CGImageDestinationAddImage(dest, image, props as CFDictionary)
    let result = CGImageDestinationFinalize(dest)

    if result {
        print("✅ JPG 处理完成: 已写入 Apple MakerNotes (key 17 = \(identifier.prefix(8))...)")
    } else {
        print("❌ JPG 写入失败")
    }
    return result
}

// MARK: - MOV Processing
func processMOV(input: URL, output: URL, identifier: String) async throws {
    let asset = AVURLAsset(url: input)

    // Synchronous track loading (deprecated but functional)
    let assetVideoTracks = asset.tracks(withMediaType: .video)
    let assetAudioTracks = asset.tracks(withMediaType: .audio)

    guard let videoTrack = assetVideoTracks.first else {
        throw NSError(domain: "livetool", code: 1,
                     userInfo: [NSLocalizedDescriptionKey: "没有找到视频轨道"])
    }

    // Get format descriptions (bridge from Any to CMFormatDescription)
    let rawDesc = videoTrack.formatDescriptions.first
    let videoFormatDesc = rawDesc as! CMFormatDescription
    let audioTrack = assetAudioTracks.first
    let audioFormatDesc = audioTrack?.formatDescriptions.first as! CMFormatDescription?

    // Create reader and writer
    let reader = try AVAssetReader(asset: asset)
    let writer = try AVAssetWriter(outputURL: output, fileType: .mov)

    // ── Set Live Photo metadata items (matching LivePhoto.swift approach) ──

    func makeMetadataItem(keySpace: AVMetadataKeySpace, key: any NSCopying & NSObjectProtocol,
                          value: any NSCopying & NSObjectProtocol, dataType: String? = nil) -> AVMutableMetadataItem {
        let item = AVMutableMetadataItem()
        item.keySpace = keySpace
        item.key = key
        item.value = value
        if let dt = dataType {
            item.dataType = dt
        }
        return item
    }

    // Content Identifier
    let contentId = makeMetadataItem(
        keySpace: .quickTimeMetadata,
        key: "com.apple.quicktime.content.identifier" as NSString,
        value: identifier as NSString,
        dataType: "com.apple.metadata.datatype.UTF-8"
    )

    // Live Photo Auto — signals this is a Live Photo video
    let liveAuto = makeMetadataItem(
        keySpace: .quickTimeMetadata,
        key: "com.apple.quicktime.live-photo.auto" as NSString,
        value: "1" as NSString,
        dataType: "com.apple.metadata.datatype.UTF-8"
    )

    // Vitality Score
    let vitalityScore = makeMetadataItem(
        keySpace: .quickTimeMetadata,
        key: "com.apple.quicktime.live-photo.vitality-score" as NSString,
        value: "1" as NSString,
        dataType: "com.apple.metadata.datatype.UTF-8"
    )

    // Vitality Scoring Version
    let vitalityVersion = makeMetadataItem(
        keySpace: .quickTimeMetadata,
        key: "com.apple.quicktime.live-photo.vitality-scoring-version" as NSString,
        value: "4" as NSString,
        dataType: "com.apple.metadata.datatype.UTF-8"
    )

    // Make & Model
    let makeItem = makeMetadataItem(
        keySpace: .quickTimeMetadata,
        key: "com.apple.quicktime.make" as NSString,
        value: "Apple" as NSString,
        dataType: "com.apple.metadata.datatype.UTF-8"
    )
    let modelItem = makeMetadataItem(
        keySpace: .quickTimeMetadata,
        key: "com.apple.quicktime.model" as NSString,
        value: "iPhone" as NSString,
        dataType: "com.apple.metadata.datatype.UTF-8"
    )

    writer.metadata = [contentId, liveAuto, vitalityScore, vitalityVersion, makeItem, modelItem]

    // ── Video track ──
    let videoInput = AVAssetWriterInput(mediaType: .video,
                                        outputSettings: nil,
                                        sourceFormatHint: videoFormatDesc)
    videoInput.expectsMediaDataInRealTime = false
    guard writer.canAdd(videoInput) else {
        throw NSError(domain: "livetool", code: 2,
                     userInfo: [NSLocalizedDescriptionKey: "无法添加视频输入"])
    }
    writer.add(videoInput)

    let videoOutput = AVAssetReaderTrackOutput(track: videoTrack, outputSettings: nil)
    guard reader.canAdd(videoOutput) else {
        throw NSError(domain: "livetool", code: 3,
                     userInfo: [NSLocalizedDescriptionKey: "无法添加视频输出"])
    }
    reader.add(videoOutput)

    // ── Audio track ──
    var audioInput: AVAssetWriterInput? = nil
    var audioOutput: AVAssetReaderTrackOutput? = nil

    if let audioTrack = audioTrack {
        let ai = AVAssetWriterInput(mediaType: .audio,
                                    outputSettings: nil,
                                    sourceFormatHint: audioFormatDesc)
        ai.expectsMediaDataInRealTime = false
        if writer.canAdd(ai) {
            writer.add(ai)
            audioInput = ai
        }

        let ao = AVAssetReaderTrackOutput(track: audioTrack, outputSettings: nil)
        if reader.canAdd(ao) {
            reader.add(ao)
            audioOutput = ao
        }
    }

    // ── Still Image Time metadata track (matching LivePhoto.swift) ──
    let keyStillImageTime = "com.apple.quicktime.still-image-time"
    let keySpaceQuickTimeMetadata = "mdta"
    let spec: NSDictionary = [
        kCMMetadataFormatDescriptionMetadataSpecificationKey_Identifier as NSString:
        "\(keySpaceQuickTimeMetadata)/\(keyStillImageTime)",
        kCMMetadataFormatDescriptionMetadataSpecificationKey_DataType as NSString:
        "com.apple.metadata.datatype.int8"
    ]
    var metadataDesc: CMFormatDescription? = nil
    CMMetadataFormatDescriptionCreateWithMetadataSpecifications(
        allocator: kCFAllocatorDefault,
        metadataType: kCMMetadataFormatType_Boxed,
        metadataSpecifications: [spec] as CFArray,
        formatDescriptionOut: &metadataDesc)
    let metadataInput = AVAssetWriterInput(mediaType: .metadata,
                                           outputSettings: nil,
                                           sourceFormatHint: metadataDesc)
    metadataInput.expectsMediaDataInRealTime = false
    if writer.canAdd(metadataInput) {
        writer.add(metadataInput)
    }
    let metadataAdaptor = AVAssetWriterInputMetadataAdaptor(assetWriterInput: metadataInput)

    // ── Start ──
    reader.startReading()
    guard writer.startWriting() else {
        throw NSError(domain: "livetool", code: 4,
                     userInfo: [NSLocalizedDescriptionKey: "写入器启动失败"])
    }
    writer.startSession(atSourceTime: .zero)

    // Add still image time metadata (matching LivePhoto.swift)
    let assetDuration = try await videoTrack.load(.timeRange).duration
    let nominalRate = try await videoTrack.load(.nominalFrameRate)
    let stillImagePercent: Float = 0.5
    let frameCount = Int(CMTimeGetSeconds(assetDuration) * Float64(nominalRate))
    let frameDuration = CMTimeMake(value: Int64(Float(assetDuration.value) / Float(frameCount)),
                                   timescale: assetDuration.timescale)
    let stillTime = CMTimeMake(value: Int64(Float(assetDuration.value) * stillImagePercent),
                               timescale: assetDuration.timescale)
    let stillRange = CMTimeRangeMake(start: stillTime, duration: frameDuration)

    let stillItem = AVMutableMetadataItem()
    stillItem.key = keyStillImageTime as (NSCopying & NSObjectProtocol)?
    stillItem.keySpace = AVMetadataKeySpace(rawValue: keySpaceQuickTimeMetadata)
    stillItem.value = 0 as (NSCopying & NSObjectProtocol)?
    stillItem.dataType = "com.apple.metadata.datatype.int8"

    metadataAdaptor.append(AVTimedMetadataGroup(items: [stillItem], timeRange: stillRange))
    metadataInput.markAsFinished()

    print("⏳ 正在处理 MOV (不重新编码,保持原始画质)...")

    // Use DispatchGroup + semaphore-based waiting (avoids async group.wait() issues)
    let readQueue = DispatchQueue(label: "read-write", attributes: .concurrent)
    let finishSema = DispatchSemaphore(value: 0)
    var processError: Error? = nil

    videoInput.requestMediaDataWhenReady(on: readQueue) {
        while videoInput.isReadyForMoreMediaData {
            if let sbuf = videoOutput.copyNextSampleBuffer() {
                if !videoInput.append(sbuf) {
                    if let error = writer.error {
                        processError = error
                    }
                    videoInput.markAsFinished()
                    finishSema.signal()
                    return
                }
            } else {
                videoInput.markAsFinished()
                finishSema.signal()
                return
            }
        }
        // If not ready, next callback will handle it
    }

    // Audio processing
    if let ai = audioInput, let ao = audioOutput {
        ai.requestMediaDataWhenReady(on: readQueue) {
            while ai.isReadyForMoreMediaData {
                if let sbuf = ao.copyNextSampleBuffer() {
                    if !ai.append(sbuf) {
                        ai.markAsFinished()
                        return
                    }
                } else {
                    ai.markAsFinished()
                    return
                }
            }
        }
    }

    // Wait for video to finish
    finishSema.wait()

    // If video finished but audio might still be processing, give it a moment
    Thread.sleep(forTimeInterval: 0.5)

    writer.finishWriting {
        if let error = writer.error {
            processError = error
        }
    }

    // Wait for writer to finish
    var isFinished = false
    while !isFinished {
        Thread.sleep(forTimeInterval: 0.1)
        if writer.status == .completed || writer.status == .failed {
            isFinished = true
        }
    }

    if let error = processError ?? writer.error {
        throw error
    }

    guard writer.status == .completed else {
        throw NSError(domain: "livetool", code: 5,
                     userInfo: [NSLocalizedDescriptionKey: "写入未完成,状态: \(writer.status.rawValue)"])
    }

    print("✅ MOV 处理完成: 已写入 Live Photo 元数据")

    // ── Verify ──
    print("\n📋 验证输出文件...")
    let fm = FileManager.default
    print("   输出 JPG: \(outputJPG.path) — \(fm.fileExists(atPath: outputJPG.path) ? "✅" : "❌")")
    print("   输出 MOV: \(outputMOV.path) — \(fm.fileExists(atPath: outputMOV.path) ? "✅" : "❌")")

    if let jpgAttr = try? fm.attributesOfItem(atPath: outputJPG.path),
       let movAttr = try? fm.attributesOfItem(atPath: outputMOV.path) {
        let jpgSz = jpgAttr[.size] as? Int64 ?? 0
        let movSz = movAttr[.size] as? Int64 ?? 0
        print("   JPG 大小: \(jpgSz / 1024) KB  |  MOV 大小: \(movSz / 1024 / 1024) MB")
    }
}

// MARK: - Main
if processJPG(input: inputJPG, output: outputJPG, identifier: assetIdentifier) {
    print("")
    Task {
        do {
            try await processMOV(input: inputMOV, output: outputMOV, identifier: assetIdentifier)
            print("")
            print("🎉 完成! Live Photo 元数据已写入文件对:")
            print("   \(outputJPG.lastPathComponent)")
            print("   \(outputMOV.lastPathComponent)")
            print("")
            print("📱 共享到 iPhone 的正确步骤:")
            print("   1. 打开 Mac「照片」应用 → 文件 → 导入")
            print("   2. **选中两个文件**，勾选「包含视频」→ 导入")
            print("   3. 开启 iCloud 照片同步，或右键 → 共享 → AirDrop → iPhone")
            print("")
            print("💡 注意: 直接 AirDrop 文件不会触发 Live Photo 配对，")
            print("   必须先导入 Mac 照片 App，iOS 通过照片 App 传输才能识别")
            exit(0)
        } catch {
            print("❌ MOV 处理失败: \(error.localizedDescription)")
            exit(1)
        }
    }
    RunLoop.current.run()
} else {
    print("❌ JPG 处理失败")
    exit(1)
}
