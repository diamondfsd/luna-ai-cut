import type { LiveStreamControlResult } from '../../../src/shared/types'

export const UCD2_MAGIC = Buffer.from([0x55, 0x43, 0x44, 0x32])
export const USB_STREAM_VIDEO = 0x20
export const USB_STREAM_CONTROL_COMMAND = 0x30
export const USB_STREAM_CONTROL_RESULT = 0x31

const MAX_FRAME_BYTES = 32 * 1024 * 1024

export interface UsbMediaFrame {
  raw: Buffer
  streamType: number
  timestampUs: bigint
  body: Buffer
  controlResult?: LiveStreamControlResult
}

interface ParsedMediaFrame {
  status: 'incomplete' | 'invalid' | 'unsupported' | 'ok'
  totalLength?: number
  reason?: string
  frame?: UsbMediaFrame
}

export function parseMediaFrame(frame: Buffer): ParsedMediaFrame {
  if (frame.length < 12) return { status: 'incomplete' }
  if (!frame.subarray(0, 4).equals(UCD2_MAGIC)) return { status: 'invalid', reason: 'magic' }

  const rawLength = frame.readUInt32LE(8)
  const totalLength = 12 + rawLength + 4
  if (rawLength < 9 || totalLength > MAX_FRAME_BYTES) {
    return { status: 'invalid', reason: 'length' }
  }
  if (frame.length < totalLength) return { status: 'incomplete' }
  if (frame[6] !== 0x01) return { status: 'unsupported', totalLength, reason: 'media-type' }

  const payload = frame.subarray(12, 12 + rawLength)
  if (payload.length < 9) return { status: 'invalid', reason: 'payload-header' }
  const streamType = payload[0]
  const timestampUs = payload.readBigUInt64LE(1)
  const body = payload.subarray(9)
  if (streamType === USB_STREAM_CONTROL_RESULT) {
    try {
      const result = JSON.parse(body.toString('utf8')) as LiveStreamControlResult
      if (!result.requestId || !result.type || typeof result.ok !== 'boolean') {
        return { status: 'invalid', totalLength, reason: 'control-result' }
      }
      return {
        status: 'ok',
        totalLength,
        frame: { raw: frame.subarray(0, totalLength), streamType, timestampUs, body, controlResult: result },
      }
    } catch {
      return { status: 'invalid', totalLength, reason: 'control-result-json' }
    }
  }
  if (streamType !== USB_STREAM_VIDEO) {
    return { status: 'unsupported', totalLength, reason: 'stream-type' }
  }
  return {
    status: 'ok',
    totalLength,
    frame: {
      raw: frame.subarray(0, totalLength),
      streamType,
      timestampUs,
      body,
    },
  }
}

export function consumeFrames(
  pending: Buffer,
  onFrame: (frame: UsbMediaFrame) => void,
  onInvalid: (reason: string) => void,
): Buffer {
  let buffer = pending
  while (buffer.length > 0) {
    const magicAt = buffer.indexOf(UCD2_MAGIC)
    if (magicAt < 0) return buffer.subarray(Math.max(0, buffer.length - UCD2_MAGIC.length + 1))
    if (magicAt > 0) buffer = buffer.subarray(magicAt)

    const parsed = parseMediaFrame(buffer)
    if (parsed.status === 'incomplete') return buffer
    if (parsed.status !== 'ok' || !parsed.frame || parsed.totalLength == null) {
      if (parsed.status === 'invalid') onInvalid(parsed.reason ?? 'unknown')
      buffer = buffer.subarray(parsed.totalLength ?? UCD2_MAGIC.length)
      continue
    }

    onFrame(parsed.frame)
    buffer = buffer.subarray(parsed.totalLength)
  }
  return buffer
}
