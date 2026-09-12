import type { DjiUdpPacket } from './djiUdpTransport'

export const DJI_PREVIEW_PACKET_TYPE = 0x02
export const DJI_PREVIEW_FRAGMENT_OFFSET = 12
export const DJI_PREVIEW_FIRST_MARKER = Buffer.from([0x00, 0x00, 0x01, 0xff])
export const DJI_PREVIEW_MAX_MESSAGE_BYTES = 8 * 1024 * 1024

export interface DjiPreviewAccessUnit {
  data: Buffer
  sequence: number
  expectedLength: number
  actualLength: number
  parts: number
  nalTypes: number[]
  codec: 'h264' | 'h265' | 'unknown'
}

export interface DjiPreviewStats {
  datagrams: number
  bytes: number
  firstFragments: number
  continuationFragments: number
  joinedMidMessage: number
  invalidTransportPackets: number
  invalidFirstFragments: number
  duplicatePackets: number
  conflictingSequencePackets: number
  outOfOrderPackets: number
  sequenceGaps: number
  nonAdjacentSequenceSlots: number
  droppedPartialMessages: number
  overrunMessages: number
  completedMessages: number
  completedBytes: number
  nalTypeCounts: Record<string, number>
  accessUnitsWithVps: number
  accessUnitsWithSps: number
  accessUnitsWithPps: number
  accessUnitsWithIdr: number
  lastExpectedLength: number | null
}

export interface DjiPreviewSnapshot extends DjiPreviewStats {
  pendingBytes: number
  pendingExpectedLength: number | null
  lastSequence: number | null
}

interface ParsedPreviewPacket {
  sequence: number
  malformedFirst: boolean
  first: boolean
  marker: boolean
  expectedLength: number | null
  frameNo: number
  position: number
  data: Buffer
}

interface PendingMessage {
  sequence: number
  expectedLength: number
  data: Buffer
  parts: number
}

interface PendingLegacyMessage {
  sequence: number
  frameNo: number
  lastPosition: number | null
  data: Buffer
  parts: number
  corrupt: boolean
}

function sequenceDelta(previous: number, current: number): number {
  return (current - previous) & 0xffff
}

function transportHeaderValid(packet: Buffer): boolean {
  if (packet.length < 8) return false
  const declaredLength = packet.readUInt16LE(0) & 0x3fff
  let xor = 0
  for (let index = 0; index < 7; index += 1) xor ^= packet[index]
  return declaredLength === packet.length && xor === packet[7]
}

function parsePreviewPacket(packet: DjiUdpPacket): ParsedPreviewPacket | null {
  if (
    packet.packetType !== DJI_PREVIEW_PACKET_TYPE ||
    packet.payload.length < DJI_PREVIEW_FRAGMENT_OFFSET ||
    !transportHeaderValid(packet.raw)
  ) return null

  const fragment = packet.payload.subarray(DJI_PREVIEW_FRAGMENT_OFFSET)
  const hasMarker = fragment.length >= DJI_PREVIEW_FIRST_MARKER.length && fragment.subarray(0, 4).equals(DJI_PREVIEW_FIRST_MARKER)
  const declaration = hasMarker && fragment.length >= 8 ? fragment.readUInt32LE(4) : null
  // Newer firmware declares the complete encoded size. Older Pocket firmware keeps the same
  // marker but leaves that field zero and uses bytes 16/17/18 to delimit a frame instead.
  const first = fragment.length >= 16 && hasMarker && declaration !== null && declaration > 0
  return {
    sequence: packet.sequence,
    malformedFirst: hasMarker && fragment.length < 16,
    first,
    marker: hasMarker,
    expectedLength: first ? declaration : null,
    frameNo: packet.payload[8] ?? 0,
    position: (packet.payload[10] ?? 0) * 2 + ((packet.payload[9] ?? 0) >>> 7),
    data: first ? fragment.subarray(16) : fragment,
  }
}

function annexBNalUnits(data: Buffer): Buffer[] {
  const starts: Array<{ offset: number; length: number }> = []
  for (let index = 0; index + 2 < data.length; index += 1) {
    if (data[index] !== 0 || data[index + 1] !== 0) continue
    if (data[index + 2] === 1) {
      starts.push({ offset: index, length: 3 })
      index += 2
    } else if (index + 3 < data.length && data[index + 2] === 0 && data[index + 3] === 1) {
      starts.push({ offset: index, length: 4 })
      index += 3
    }
  }
  return starts.flatMap((start, index) => {
    const from = start.offset + start.length
    const to = index + 1 < starts.length ? starts[index + 1]!.offset : data.length
    return to > from ? [data.subarray(from, to)] : []
  })
}

function detectCodec(units: Buffer[]): 'h264' | 'h265' | 'unknown' {
  for (const unit of units) {
    const first = unit[0]
    if (first === 0x40 || first === 0x42 || first === 0x44) return 'h265'
    if (first === 0x67 || first === 0x68) return 'h264'
  }
  return 'unknown'
}

function annexBNalTypes(data: Buffer, codec: 'h264' | 'h265' | 'unknown'): number[] {
  if (codec === 'unknown') return []
  return annexBNalUnits(data).flatMap((unit) => {
    const first = unit[0]
    if (first === undefined) return []
    return [codec === 'h265' ? (first >>> 1) & 0x3f : first & 0x1f]
  })
}

function isStartCode(data: Buffer, offset: number): number {
  if (offset + 2 >= data.length || data[offset] !== 0 || data[offset + 1] !== 0) return 0
  if (data[offset + 2] === 1) return 3
  return offset + 3 < data.length && data[offset + 2] === 0 && data[offset + 3] === 1 ? 4 : 0
}

function stripDjiMarker(data: Buffer): Buffer {
  for (let marker = 0; marker + 3 < data.length; marker += 1) {
    const startLength = isStartCode(data, marker)
    if (!startLength || data[marker + startLength] !== 0xff) continue
    for (let next = marker + startLength + 1; next + 2 < data.length; next += 1) {
      const nextStartLength = isStartCode(data, next)
      if (nextStartLength && data[next + nextStartLength] !== 0xff) return data.subarray(next)
    }
    // A marker without a following standard NAL is incomplete, but it is still safer to preserve
    // the input than to guess a fixed header size. The sized packet path already removes its 16-byte
    // marker header before reaching this helper.
    return data
  }
  return data
}

function emptyStats(): DjiPreviewStats {
  return {
    datagrams: 0,
    bytes: 0,
    firstFragments: 0,
    continuationFragments: 0,
    joinedMidMessage: 0,
    invalidTransportPackets: 0,
    invalidFirstFragments: 0,
    duplicatePackets: 0,
    conflictingSequencePackets: 0,
    outOfOrderPackets: 0,
    sequenceGaps: 0,
    nonAdjacentSequenceSlots: 0,
    droppedPartialMessages: 0,
    overrunMessages: 0,
    completedMessages: 0,
    completedBytes: 0,
    nalTypeCounts: {},
    accessUnitsWithVps: 0,
    accessUnitsWithSps: 0,
    accessUnitsWithPps: 0,
    accessUnitsWithIdr: 0,
    lastExpectedLength: null,
  }
}

export class DjiPreviewReassembler {
  private current: PendingMessage | null = null
  private legacyCurrent: PendingLegacyMessage | null = null
  private sizedMode = false
  private lastSequence: number | null = null
  private readonly sequencePackets = new Map<number, Buffer>()
  private statsValue = emptyStats()
  private readonly onAccessUnit: (unit: DjiPreviewAccessUnit) => void
  private readonly dedupe: boolean
  private readonly strictSequence: boolean
  private readonly maxMessageBytes: number

  constructor(
    onAccessUnit: (unit: DjiPreviewAccessUnit) => void = () => undefined,
    dedupe = true,
    strictSequence = true,
    maxMessageBytes = DJI_PREVIEW_MAX_MESSAGE_BYTES,
  ) {
    this.onAccessUnit = onAccessUnit
    this.dedupe = dedupe
    this.strictSequence = strictSequence
    this.maxMessageBytes = maxMessageBytes
  }

  reset(): void {
    this.current = null
    this.legacyCurrent = null
    this.sizedMode = false
    this.lastSequence = null
    this.sequencePackets.clear()
    this.statsValue = emptyStats()
  }

  snapshot(): DjiPreviewSnapshot {
    return {
      ...this.statsValue,
      nalTypeCounts: { ...this.statsValue.nalTypeCounts },
      pendingBytes: this.current?.data.length ?? this.legacyCurrent?.data.length ?? 0,
      pendingExpectedLength: this.current?.expectedLength ?? null,
      lastSequence: this.lastSequence,
    }
  }

  feed(packet: DjiUdpPacket): DjiPreviewAccessUnit | null {
    const parsed = parsePreviewPacket(packet)
    if (!parsed) {
      if (packet.packetType === DJI_PREVIEW_PACKET_TYPE) this.statsValue.invalidTransportPackets += 1
      return null
    }

    this.statsValue.datagrams += 1
    this.statsValue.bytes += packet.raw.length
    // Sized frames have no frame/position fallback, so transport sequence is their
    // completeness signal. Legacy Pocket 3 frames use the fragment position instead;
    // their transport sequence can jump between datagrams without losing the frame.
    const enforceSequence = this.strictSequence && (this.sizedMode || parsed.first)
    if (!this.trackSequence(parsed.sequence, packet.raw, enforceSequence)) return null

    if (parsed.malformedFirst) {
      this.statsValue.invalidFirstFragments += 1
      this.dropPartial('short-first-fragment')
      return null
    }

    if (parsed.first) {
      this.statsValue.firstFragments += 1
      const expectedLength = parsed.expectedLength!
      if (expectedLength <= 0 || expectedLength > this.maxMessageBytes || parsed.data.length > expectedLength) {
        this.statsValue.invalidFirstFragments += 1
        this.current = null
        return null
      }
      this.dropPartial('new-first-fragment')
      this.sizedMode = true
      this.current = {
        sequence: parsed.sequence,
        expectedLength,
        data: Buffer.from(parsed.data),
        parts: 1,
      }
      this.statsValue.lastExpectedLength = expectedLength
      if (parsed.data.length === expectedLength) {
        const pending = this.current
        this.current = null
        return this.complete(pending.data, pending.sequence, pending.expectedLength, pending.parts)
      }
      return null
    } else if (this.sizedMode) {
      this.statsValue.continuationFragments += 1
      if (!this.current) {
        this.statsValue.joinedMidMessage += 1
        return null
      }
      this.current.data = Buffer.concat([this.current.data, parsed.data])
      this.current.parts += 1
      if (this.current.data.length > this.current.expectedLength) {
        this.statsValue.overrunMessages += 1
        this.current = null
        return null
      }
      if (!this.current || this.current.data.length < this.current.expectedLength) return null

      const pending = this.current
      this.current = null
      if (pending.data.length !== pending.expectedLength) {
        this.statsValue.overrunMessages += 1
        return null
      }
      return this.complete(pending.data, pending.sequence, pending.expectedLength, pending.parts)
    }

    // Legacy Pocket packets have no declared length. The frame/group counters in the fragment
    // header delimit the access unit and the next frame causes the previous one to be emitted.
    this.statsValue.continuationFragments += 1
    return this.feedLegacy(parsed)
  }

  private feedLegacy(parsed: ParsedPreviewPacket): DjiPreviewAccessUnit | null {
    let completed: DjiPreviewAccessUnit | null = null
    const current = this.legacyCurrent
    if (!current) {
      if (!parsed.marker) {
        this.statsValue.joinedMidMessage += 1
        return null
      }
      this.legacyCurrent = {
        sequence: parsed.sequence,
        frameNo: parsed.frameNo,
        lastPosition: parsed.position,
        data: Buffer.from(parsed.data),
        parts: 1,
        corrupt: false,
      }
      return null
    }

    if (current.frameNo !== parsed.frameNo || parsed.position < (current.lastPosition ?? -1)) {
      completed = this.finishLegacy()
      this.legacyCurrent = {
        sequence: parsed.sequence,
        frameNo: parsed.frameNo,
        lastPosition: parsed.position,
        data: Buffer.from(parsed.data),
        parts: 1,
        corrupt: false,
      }
      return completed
    }
    if (parsed.position === current.lastPosition) return completed
    if (parsed.position !== (current.lastPosition ?? -1) + 1) current.corrupt = true
    current.lastPosition = parsed.position
    current.parts += 1
    if (current.data.length + parsed.data.length > this.maxMessageBytes) {
      current.corrupt = true
      return completed
    }
    current.data = Buffer.concat([current.data, parsed.data])
    return completed
  }

  private finishLegacy(): DjiPreviewAccessUnit | null {
    const pending = this.legacyCurrent
    this.legacyCurrent = null
    if (!pending) return null
    if (pending.corrupt) {
      this.statsValue.droppedPartialMessages += 1
      return null
    }
    const data = stripDjiMarker(pending.data)
    if (data.length === 0) return null
    return this.complete(data, pending.sequence, data.length, pending.parts)
  }

  private complete(data: Buffer, sequence: number, expectedLength: number, parts: number): DjiPreviewAccessUnit {
    const nals = annexBNalUnits(data)
    const codec = detectCodec(nals)
    const nalTypes = annexBNalTypes(data, codec)
    const nalTypeSet = new Set(nalTypes)
    for (const type of nalTypes) {
      const key = String(type)
      this.statsValue.nalTypeCounts[key] = (this.statsValue.nalTypeCounts[key] ?? 0) + 1
    }
    if (codec === 'h265' && nalTypeSet.has(32)) this.statsValue.accessUnitsWithVps += 1
    if (codec === 'h265' && nalTypeSet.has(33)) this.statsValue.accessUnitsWithSps += 1
    if (codec === 'h265' && nalTypeSet.has(34)) this.statsValue.accessUnitsWithPps += 1
    if (
      (codec === 'h265' && nalTypes.some((type) => type >= 16 && type <= 21))
      || (codec === 'h264' && nalTypeSet.has(5))
    ) this.statsValue.accessUnitsWithIdr += 1
    this.statsValue.completedMessages += 1
    this.statsValue.completedBytes += data.length

    const unit: DjiPreviewAccessUnit = {
      data,
      sequence,
      expectedLength,
      actualLength: data.length,
      parts,
      nalTypes,
      codec,
    }
    this.onAccessUnit(unit)
    return unit
  }

  private dropPartial(reason: 'overrun' | 'short-first-fragment' | 'new-first-fragment' | 'sequence'): void {
    if (!this.current && !this.legacyCurrent) return
    this.statsValue.droppedPartialMessages += 1
    this.current = null
    this.legacyCurrent = null
    if (reason === 'overrun') this.statsValue.overrunMessages += 1
  }

  private rememberSequence(sequence: number, packet: Buffer): boolean {
    if (!this.dedupe) return true

    const previous = this.sequencePackets.get(sequence)
    if (previous) {
      if (previous.equals(packet)) this.statsValue.duplicatePackets += 1
      else this.statsValue.conflictingSequencePackets += 1
      return false
    }

    if (this.lastSequence != null) {
      const delta = sequenceDelta(this.lastSequence, sequence)
      if (sequence < this.lastSequence && delta > 0 && delta < 0x8000) this.sequencePackets.clear()
    }
    this.sequencePackets.set(sequence, packet)
    if (this.sequencePackets.size > 16384) {
      const first = this.sequencePackets.keys().next().value
      if (first !== undefined) this.sequencePackets.delete(first)
    }
    return true
  }

  private trackSequence(sequence: number, packet: Buffer, enforceSequence: boolean): boolean {
    if (!this.rememberSequence(sequence, packet)) return false
    if (this.lastSequence != null) {
      const delta = sequenceDelta(this.lastSequence, sequence)
      if (delta === 0) {
        this.statsValue.duplicatePackets += 1
        return false
      }
      if (delta >= 0x8000) {
        this.statsValue.outOfOrderPackets += 1
        if (enforceSequence) {
          this.dropPartial('sequence')
          return false
        }
      }
      if (delta !== 8) {
        this.statsValue.sequenceGaps += 1
        if (delta % 8 === 0) this.statsValue.nonAdjacentSequenceSlots += Math.max(0, (delta / 8) - 1)
        if (enforceSequence) this.dropPartial('sequence')
      }
    }
    this.lastSequence = sequence
    return true
  }
}
