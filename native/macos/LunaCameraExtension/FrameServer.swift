import Foundation
import Darwin

struct CameraFramePacket {
    let type: UInt8
    let flags: UInt16
    let sequence: UInt32
    let timestampUs: UInt64
    let payload: Data
}

final class FrameServer {
    private static let magic = Data([0x4c, 0x56, 0x43, 0x46]) // LVCF
    private let port: UInt16
    private let queue = DispatchQueue(label: "com.diamondfsd.lunaaicut.camera.frames", qos: .userInitiated)
    private var listener: Int32 = -1
    private var running = false
    private let onPacket: (CameraFramePacket) -> Void

    init(port: UInt16, onPacket: @escaping (CameraFramePacket) -> Void) {
        self.port = port
        self.onPacket = onPacket
    }

    func start() throws {
        let socket = Darwin.socket(AF_INET, SOCK_STREAM, 0)
        guard socket >= 0 else { throw FrameServerError.socket(errno) }

        var reuse: Int32 = 1
        setsockopt(socket, SOL_SOCKET, SO_REUSEADDR, &reuse, socklen_t(MemoryLayout<Int32>.size))

        var address = sockaddr_in()
        address.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        address.sin_family = sa_family_t(AF_INET)
        address.sin_port = port.bigEndian
        address.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))

        let bindResult = withUnsafePointer(to: &address) { pointer in
            pointer.withMemoryRebound(to: sockaddr.self, capacity: 1) {
                Darwin.bind(socket, $0, socklen_t(MemoryLayout<sockaddr_in>.size))
            }
        }
        guard bindResult == 0 else {
            Darwin.close(socket)
            throw FrameServerError.socket(errno)
        }
        guard Darwin.listen(socket, 1) == 0 else {
            Darwin.close(socket)
            throw FrameServerError.socket(errno)
        }

        listener = socket
        running = true
        queue.async { [weak self] in self?.acceptLoop() }
    }

    func stop() {
        running = false
        let socket = listener
        listener = -1
        if socket >= 0 {
            Darwin.shutdown(socket, SHUT_RDWR)
            Darwin.close(socket)
        }
    }

    private func acceptLoop() {
        while running {
            let client = Darwin.accept(listener, nil, nil)
            guard client >= 0 else {
                if running { continue }
                return
            }
            readLoop(client)
            Darwin.shutdown(client, SHUT_RDWR)
            Darwin.close(client)
        }
    }

    private func readLoop(_ client: Int32) {
        while running {
            guard let header = readExactly(client, count: 24) else { return }
            guard header.prefix(4) == Self.magic, header[4] == 1 else { return }
            let type = header[5]
            let flags = readUInt16(header, offset: 6)
            let timestampUs = readUInt64(header, offset: 8)
            let sequence = readUInt32(header, offset: 16)
            let payloadLength = Int(readUInt32(header, offset: 20))
            guard payloadLength <= 16 * 1024 * 1024, let payload = readExactly(client, count: payloadLength) else { return }
            onPacket(CameraFramePacket(type: type, flags: flags, sequence: sequence, timestampUs: timestampUs, payload: payload))
        }
    }

    private func readExactly(_ socket: Int32, count: Int) -> Data? {
        if count == 0 { return Data() }
        var output = Data(count: count)
        var offset = 0
        while offset < count {
            let received = output.withUnsafeMutableBytes { rawBuffer -> Int in
                guard let baseAddress = rawBuffer.baseAddress else { return -1 }
                return Darwin.recv(socket, baseAddress.advanced(by: offset), count - offset, 0)
            }
            if received <= 0 { return nil }
            offset += received
        }
        return output
    }

    private func readUInt16(_ data: Data, offset: Int) -> UInt16 {
        UInt16(data[offset]) | UInt16(data[offset + 1]) << 8
    }

    private func readUInt32(_ data: Data, offset: Int) -> UInt32 {
        UInt32(data[offset])
            | UInt32(data[offset + 1]) << 8
            | UInt32(data[offset + 2]) << 16
            | UInt32(data[offset + 3]) << 24
    }

    private func readUInt64(_ data: Data, offset: Int) -> UInt64 {
        var value: UInt64 = 0
        for index in 0..<8 { value |= UInt64(data[offset + index]) << (index * 8) }
        return value
    }
}

enum FrameServerError: Error, CustomStringConvertible {
    case socket(Int32)

    var description: String {
        switch self {
        case .socket(let code): return "frame server socket error: \(String(cString: strerror(code)))"
        }
    }
}
