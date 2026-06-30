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
func processMOV(input: URL, output: URL, identifier: String) throws {
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

    // ── Set Live Photo metadata items ──

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

    // 1. Content Identifier — the critical pairing UUID (matches JPG)
    let contentId = makeMetadataItem(
        keySpace: .quickTimeMetadata,
        key: "com.apple.quicktime.content.identifier" as NSString,
        value: identifier as NSString,
        dataType: kCMMetadataBaseDataType_UTF8 as String
    )

    // 2. Still Image Time — when in the video the still was taken (0 = start)
    let stillImageTime = makeMetadataItem(
        keySpace: .quickTimeMetadata,
        key: "com.apple.quicktime.still-image-time" as NSString,
        value: 0 as NSNumber,
        dataType: kCMMetadataBaseDataType_SInt8 as String
    )

    // 3. Creation date
    let df = DateFormatter()
    df.dateFormat = "yyyy-MM-dd'T'HH:mm:ssZZZZZ"
    let creationDate = makeMetadataItem(
        keySpace: .quickTimeMetadata,
        key: "com.apple.quicktime.creation-date" as NSString,
        value: df.string(from: Date()) as NSString,
        dataType: kCMMetadataBaseDataType_UTF8 as String
    )

    // 4. Make and model (Apple-standard)
    let makeItem = makeMetadataItem(
        keySpace: .quickTimeMetadata,
        key: "com.apple.quicktime.make" as NSString,
        value: "Apple" as NSString,
        dataType: kCMMetadataBaseDataType_UTF8 as String
    )
    let modelItem = makeMetadataItem(
        keySpace: .quickTimeMetadata,
        key: "com.apple.quicktime.model" as NSString,
        value: "iPhone" as NSString,
        dataType: kCMMetadataBaseDataType_UTF8 as String
    )

    // 5. Also write to QuickTime UserData for broader compatibility
    let contentIdUD = makeMetadataItem(
        keySpace: .quickTimeUserData,
        key: "\\xa9inf" as NSString,  // UserData copyright info
        value: identifier as NSString,
        dataType: kCMMetadataBaseDataType_UTF8 as String
    )

    writer.metadata = [contentId, stillImageTime, creationDate, makeItem, modelItem, contentIdUD]

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

    // ── Start ──
    reader.startReading()
    guard writer.startWriting() else {
        throw NSError(domain: "livetool", code: 4,
                     userInfo: [NSLocalizedDescriptionKey: "写入器启动失败"])
    }
    writer.startSession(atSourceTime: .zero)

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
    do {
        try processMOV(input: inputMOV, output: outputMOV, identifier: assetIdentifier)
        print("")
        print("🎉 完成! Live Photo 元数据已写入文件对:")
        print("   \(outputJPG.lastPathComponent)")
        print("   \(outputMOV.lastPathComponent)")
        print("")
        print("📱 使用方式:")
        print("   1. 确保两个文件在**同一目录**且**同名**")
        print("   2. AirDrop 传输到 iPhone → 照片 App 自动识别")
        print("   3. 或在 Mac 上导入「照片」应用 (勾选「包含视频」)")
        print("")
        print("💡 提示: 文件名必须配对 — 系统通过文件名关联 JPG 和 MOV")
    } catch {
        print("❌ MOV 处理失败: \(error.localizedDescription)")
        exit(1)
    }
} else {
    print("❌ JPG 处理失败")
    exit(1)
}
