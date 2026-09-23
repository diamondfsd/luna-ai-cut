import Foundation
import Network
import OSLog

final class LunaTcpHevcReceiver {
    private let listener: NWListener
    private let decoder: LunaHevcDecoder
    private let audioRenderer: LunaAudioRenderer
    private let logger = Logger(subsystem: "com.diamondfsd.luna.virtualcamera.host", category: "tcp-receiver")
    private let queue = DispatchQueue(label: "com.diamondfsd.luna.hevc-receiver")
    private var connections = [ObjectIdentifier: NWConnection]()
    private var receivedBytes: UInt64 = 0
    private var receivedPackets: UInt64 = 0

    init(port: UInt16 = 4184, decoder: LunaHevcDecoder, audioRenderer: LunaAudioRenderer) throws {
        self.decoder = decoder
        self.audioRenderer = audioRenderer
        listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
    }

    func start() {
        listener.start(queue: queue)
    }

    private func accept(_ connection: NWConnection) {
        trace("accepted connection")
        let id = ObjectIdentifier(connection)
        connections[id] = connection
        connection.stateUpdateHandler = { [weak self] state in
            if case .failed = state { self?.connections.removeValue(forKey: id) }
        }
        connection.start(queue: queue)
        receive(connection, buffer: Data())
    }

    private func receive(_ connection: NWConnection, buffer: Data) {
        connection.receive(minimumIncompleteLength: 1, maximumLength: 4 * 1024 * 1024) { [weak self] data, _, isComplete, _ in
            guard let self else { return }
            var pending = buffer
            if let data { pending.append(data) }
            if let data {
                receivedBytes += UInt64(data.count)
                if receivedBytes <= UInt64(data.count) || receivedBytes.isMultiple(of: 1_000_000) {
                    trace("received bytes total: \(receivedBytes)")
                }
            }
            pending = self.parse(pending)
            if !isComplete { self.receive(connection, buffer: pending) }
        }
    }

    private func parse(_ data: Data) -> Data {
        var pending = data
        let magic = Data([0x55, 0x43, 0x44, 0x32])
        while pending.count >= 16 {
            guard let range = pending.range(of: magic) else { return Data(pending.suffix(3)) }
            if range.lowerBound != pending.startIndex {
                pending.removeSubrange(pending.startIndex..<range.lowerBound)
            }
            guard pending.count >= 12 else { return pending }
            let type = pending[pending.index(pending.startIndex, offsetBy: 6)]
            let length = pending.readUInt32LE(at: 8)
            let total = 16 + Int(length)
            guard length >= 9, total <= 32 * 1024 * 1024 else {
                trace("invalid packet length: \(length)")
                pending.removeFirst(); continue
            }
            guard pending.count >= total else { return pending }
            if type == 0x01 {
                let payloadStart = pending.index(pending.startIndex, offsetBy: 12)
                let streamType = pending[payloadStart]
                let timestamp = pending.readUInt64LE(at: 13)
                if streamType == 0x20 {
                    receivedPackets += 1
                    if receivedPackets == 1 || receivedPackets.isMultiple(of: 30) {
                        trace("video packet \(receivedPackets), bytes: \(length - 9)")
                    }
                    let video = Data(pending[payloadStart...].dropFirst(9).prefix(Int(length) - 9))
                    decoder.decodeAnnexB(video, timestamp: timestamp)
                } else if streamType == 0x21 {
                    parseAudio(pending, payloadStart: payloadStart, length: Int(length))
                } else if streamType == 0x22, length >= 13 {
                    let bodyStart = pending.index(payloadStart, offsetBy: 9)
                    let milliseconds = pending.readInt32LE(at: pending.distance(from: pending.startIndex, to: bodyStart))
                    audioRenderer.setDelay(milliseconds: Int(milliseconds))
                }
            }
            pending.removeFirst(total)
        }
        return pending
    }

    private func trace(_ message: String) {
        logger.info("\(message, privacy: .public)")
        print("[LunaTcpHevcReceiver] \(message)")
        let line = "\(Date()) \(message)\n"
        let url = LunaCameraSharedFrameStore.sharedURL()?
            .deletingLastPathComponent()
            .appendingPathComponent("host-debug.log")
            ?? URL(fileURLWithPath: "/tmp/luna-hevc.log")
        if let handle = try? FileHandle(forWritingTo: url) {
            handle.seekToEndOfFile()
            handle.write(Data(line.utf8))
            try? handle.close()
        } else {
            try? Data(line.utf8).write(to: url, options: .atomic)
        }
    }

    private func parseAudio(_ packet: Data, payloadStart: Data.Index, length: Int) {
        guard length >= 21 else { return }
        let bodyStart = packet.index(payloadStart, offsetBy: 9)
        let bodyOffset = packet.distance(from: packet.startIndex, to: bodyStart)
        guard packet[bodyOffset] == 0x01 else { return }
        let sampleRate = Int(packet.readUInt32LE(at: bodyOffset + 2))
        let channels = Int(packet[bodyOffset + 6])
        let sampleCount = Int(packet.readUInt32LE(at: bodyOffset + 8))
        let byteCount = sampleCount * channels * 2
        let pcmStart = packet.index(bodyStart, offsetBy: 12)
        guard sampleRate > 0, channels > 0, sampleCount > 0,
              packet.distance(from: pcmStart, to: packet.endIndex) >= byteCount else { return }
        audioRenderer.enqueuePCM16(
            Data(packet[pcmStart..<packet.index(pcmStart, offsetBy: byteCount)]),
            sampleRate: sampleRate,
            channels: channels,
            sampleCount: sampleCount
        )
    }
}

private extension Data {
    func readUInt32LE(at offset: Int) -> UInt32 {
        let start = index(startIndex, offsetBy: offset)
        return UInt32(self[start])
            | (UInt32(self[index(start, offsetBy: 1)]) << 8)
            | (UInt32(self[index(start, offsetBy: 2)]) << 16)
            | (UInt32(self[index(start, offsetBy: 3)]) << 24)
    }

    func readUInt64LE(at offset: Int) -> UInt64 {
        let start = index(startIndex, offsetBy: offset)
        var value = UInt64.zero
        for byteOffset in 0..<8 {
            value |= UInt64(self[index(start, offsetBy: byteOffset)]) << UInt64(byteOffset * 8)
        }
        return value
    }

    func readInt32LE(at offset: Int) -> Int32 {
        Int32(bitPattern: readUInt32LE(at: offset))
    }
}
