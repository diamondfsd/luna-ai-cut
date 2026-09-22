import Foundation
import Network

final class LunaTcpHevcReceiver {
    private let listener: NWListener
    private let decoder: LunaHevcDecoder
    private let queue = DispatchQueue(label: "com.diamondfsd.luna.hevc-receiver")
    private var connections = [ObjectIdentifier: NWConnection]()

    init(port: UInt16 = 4184, decoder: LunaHevcDecoder) throws {
        self.decoder = decoder
        listener = try NWListener(using: .tcp, on: NWEndpoint.Port(rawValue: port)!)
        listener.newConnectionHandler = { [weak self] connection in
            self?.accept(connection)
        }
    }

    func start() {
        listener.start(queue: queue)
    }

    private func accept(_ connection: NWConnection) {
        print("[LunaTcpHevcReceiver] accepted connection")
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
            if let data { print("[LunaTcpHevcReceiver] received bytes: \(data.count)") }
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
                pending.removeFirst(); continue
            }
            guard pending.count >= total else { return pending }
            if type == 0x01 {
                let payloadStart = pending.index(pending.startIndex, offsetBy: 12)
                let timestamp = pending.readUInt64LE(at: 13)
                let video = Data(pending[payloadStart...].dropFirst(9).prefix(Int(length) - 9))
                decoder.decodeAnnexB(video, timestamp: timestamp)
            }
            pending.removeFirst(total)
        }
        return pending
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
}
