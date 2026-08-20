import { Buffer } from 'node:buffer'

export const BRIDGE_MAGIC = Buffer.from('LBRG', 'ascii')
export const BRIDGE_VERSION = 1
export const BRIDGE_HEADER_BYTES = 24
export const BRIDGE_TRAILER_BYTES = 4
export const BRIDGE_MAX_PAYLOAD_BYTES = 16 * 1024 * 1024

export const BRIDGE_TYPES = Object.freeze({
  HELLO: 1,
  VIDEO_CONFIG: 2,
  VIDEO: 3,
  AUDIO: 4,
  METADATA: 5,
  CAMERA_STATUS: 6,
  CONTROL: 7,
  ERROR: 255,
})

export const BRIDGE_FLAGS = Object.freeze({
  KEYFRAME: 1,
  ANNEX_B: 1 << 1,
  END_OF_FRAME: 1 << 2,
})

export type BridgeFrame = {
  flags: number
  payload: Buffer
  sequence: number
  timestampUs: bigint
  type: number
}

export class BridgeFrameParser {
  private buffer = Buffer.alloc(0)
  readonly errors: string[] = []

  push(chunk: Uint8Array): BridgeFrame[] {
    this.buffer = Buffer.concat([this.buffer, Buffer.from(chunk)])
    const frames: BridgeFrame[] = []
    while (this.buffer.length >= BRIDGE_HEADER_BYTES) {
      const start = this.buffer.indexOf(BRIDGE_MAGIC)
      if (start < 0) {
        this.buffer = this.buffer.subarray(Math.max(0, this.buffer.length - 3))
        break
      }
      if (start > 0) {
        this.errors.push(`丢弃 ${start} 字节的无效 USB 前缀`)
        this.buffer = this.buffer.subarray(start)
      }
      if (this.buffer.length < BRIDGE_HEADER_BYTES) break
      if (this.buffer.readUInt8(4) !== BRIDGE_VERSION) {
        this.errors.push('不支持的 Bridge 版本')
        this.buffer = this.buffer.subarray(4)
        continue
      }
      const payloadLength = this.buffer.readUInt32LE(20)
      if (payloadLength > BRIDGE_MAX_PAYLOAD_BYTES) {
        this.errors.push('USB Bridge payload 过大')
        this.buffer = this.buffer.subarray(4)
        continue
      }
      const frameLength = BRIDGE_HEADER_BYTES + payloadLength + BRIDGE_TRAILER_BYTES
      if (this.buffer.length < frameLength) break
      const candidate = this.buffer.subarray(0, frameLength)
      this.buffer = this.buffer.subarray(frameLength)
      const receivedCrc = candidate.readUInt32LE(frameLength - BRIDGE_TRAILER_BYTES)
      const calculatedCrc = crc32(candidate.subarray(0, frameLength - BRIDGE_TRAILER_BYTES))
      if (receivedCrc !== calculatedCrc) {
        this.errors.push('USB Bridge CRC 校验失败')
        continue
      }
      frames.push({
        flags: candidate.readUInt16LE(6),
        payload: candidate.subarray(BRIDGE_HEADER_BYTES, BRIDGE_HEADER_BYTES + payloadLength),
        sequence: candidate.readUInt32LE(16),
        timestampUs: candidate.readBigUInt64LE(8),
        type: candidate.readUInt8(5),
      })
    }
    return frames
  }
}

function crc32(buffer: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc & 1) !== 0 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}
