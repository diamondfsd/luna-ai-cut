import CoreVideo
import Foundation

/// Latest-frame transport shared by the receiver process and camera extension.
/// The extension never owns the network or HEVC pipeline; it only consumes decoded
/// BGRA frames published here.
public final class LunaCameraSharedFrameStore: @unchecked Sendable {
    public static let appGroupIdentifier = "8B6J8663PS.com.diamondfsd.luna.virtualcamera"
    private static let frameFileName = "latest-bgra.frame"

    public struct Frame: Sendable {
        public let sequence: UInt64
        public let timestamp: UInt64
        public let width: Int
        public let height: Int
        public let pixelFormat: OSType
        public let bytes: Data

        public init(
            sequence: UInt64,
            timestamp: UInt64,
            width: Int,
            height: Int,
            pixelFormat: OSType,
            bytes: Data
        ) {
            self.sequence = sequence
            self.timestamp = timestamp
            self.width = width
            self.height = height
            self.pixelFormat = pixelFormat
            self.bytes = bytes
        }
    }

    private let lock = NSLock()
    private var latestFrame: Frame?

    public init() {}

    public static func sharedURL() -> URL? {
#if DEBUG
        return URL(fileURLWithPath: "/tmp").appendingPathComponent(frameFileName)
#else
        FileManager.default.containerURL(
            forSecurityApplicationGroupIdentifier: appGroupIdentifier
        )?.appendingPathComponent(frameFileName)
            ?? URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent(frameFileName)
#endif
    }

    /// Publishes a tightly packed BGRA frame through the App Group container.
    /// The file is replaced atomically so the extension never reads a partial frame.
    public static func publishBGRA(
        bytes: Data,
        width: Int,
        height: Int,
        sequence: UInt64,
        timestamp: UInt64
    ) throws {
        guard let url = sharedURL() else {
            throw CocoaError(.fileNoSuchFile)
        }
        let header = FrameHeader(
            sequence: sequence,
            timestamp: timestamp,
            width: UInt32(width),
            height: UInt32(height),
            payloadLength: UInt64(bytes.count)
        )
        var data = Data()
        data.append(FrameHeader.magic)
        data.append(contentsOf: header.sequence.littleEndianBytes)
        data.append(contentsOf: header.timestamp.littleEndianBytes)
        data.append(contentsOf: header.width.littleEndianBytes)
        data.append(contentsOf: header.height.littleEndianBytes)
        data.append(contentsOf: header.payloadLength.littleEndianBytes)
        data.append(bytes)

        let directory = url.deletingLastPathComponent()
        try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
        let temporaryURL = directory.appendingPathComponent(
            ".latest-bgra.frame.\(UUID().uuidString).tmp"
        )
        try data.write(to: temporaryURL, options: .atomic)
        if FileManager.default.fileExists(atPath: url.path) {
            _ = try FileManager.default.replaceItemAt(url, withItemAt: temporaryURL)
        } else {
            try FileManager.default.moveItem(at: temporaryURL, to: url)
        }
    }

    public static func readLatestBGRA() -> (width: Int, height: Int, sequence: UInt64, timestamp: UInt64, bytes: Data)? {
        guard let url = sharedURL(), let data = try? Data(contentsOf: url), data.count >= FrameHeader.byteCount else {
            return nil
        }
        guard data.prefix(4) == FrameHeader.magic else { return nil }
        let sequence = data.readUInt64(at: 4)
        let timestamp = data.readUInt64(at: 12)
        let width = Int(data.readUInt32(at: 20))
        let height = Int(data.readUInt32(at: 24))
        let payloadLength = Int(data.readUInt64(at: 28))
        guard width > 0, height > 0, payloadLength >= 0,
              data.count == FrameHeader.byteCount + payloadLength else { return nil }
        return (width, height, sequence, timestamp, data.subdata(in: FrameHeader.byteCount..<data.count))
    }

    public func publish(_ frame: Frame) {
        lock.lock()
        latestFrame = frame
        lock.unlock()
    }

    public func latest() -> Frame? {
        lock.lock()
        defer { lock.unlock() }
        return latestFrame
    }
}

private struct FrameHeader {
    static let magic = Data([0x4C, 0x55, 0x4E, 0x41])
    static let byteCount = 36
    let sequence: UInt64
    let timestamp: UInt64
    let width: UInt32
    let height: UInt32
    let payloadLength: UInt64
}

private extension FixedWidthInteger {
    var littleEndianBytes: [UInt8] {
        withUnsafeBytes(of: littleEndian) { Array($0) }
    }
}

private extension Data {
    func readUInt32(at offset: Int) -> UInt32 {
        UInt32(self[offset])
            | (UInt32(self[offset + 1]) << 8)
            | (UInt32(self[offset + 2]) << 16)
            | (UInt32(self[offset + 3]) << 24)
    }

    func readUInt64(at offset: Int) -> UInt64 {
        var value = UInt64.zero
        for index in 0..<8 {
            value |= UInt64(self[offset + index]) << UInt64(index * 8)
        }
        return value
    }
}
