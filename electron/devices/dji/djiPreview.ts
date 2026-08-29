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
  expectedLength: number | null
  data: Buffer
}

interface PendingMessage {
  sequence: number
  expectedLength: number
  data: Buffer
  parts: number
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
  const first = fragment.length >= 16 && hasMarker
  return {
    sequence: packet.sequence,
    malformedFirst: hasMarker && !first,
    first,
    expectedLength: first ? fragment.readUInt32LE(4) : null,
    data: first ? fragment.subarray(16) : fragment,
  }
}

function annexBNalTypes(data: Buffer): number[] {
  const types: number[] = []
  for (let index = 0; index + 3 < data.length;) {
    let startLength = 0
    if (data[index] === 0x00 && data[index + 1] === 0x00 && data[index + 2] === 0x01) {
      startLength = 3
    } else if (
      index + 4 < data.length &&
      data[index] === 0x00 && data[index + 1] === 0x00 &&
      data[index + 2] === 0x00 && data[index + 3] === 0x01
    ) {
      startLength = 4
    }
    if (startLength > 0 && index + startLength + 1 < data.length) {
      types.push((data[index + startLength]! >>> 1) & 0x3f)
      index += startLength
    } else {
      index += 1
    }
  }
  return types
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
    strictSequence = false,
    maxMessageBytes = DJI_PREVIEW_MAX_MESSAGE_BYTES,
  ) {
    this.onAccessUnit = onAccessUnit
    this.dedupe = dedupe
    this.strictSequence = strictSequence
    this.maxMessageBytes = maxMessageBytes
  }

  reset(): void {
    this.current = null
    this.lastSequence = null
    this.sequencePackets.clear()
    this.statsValue = emptyStats()
  }

  snapshot(): DjiPreviewSnapshot {
    return {
      ...this.statsValue,
      nalTypeCounts: { ...this.statsValue.nalTypeCounts },
      pendingBytes: this.current?.data.length ?? 0,
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
    if (!this.trackSequence(parsed.sequence, packet.raw)) return null

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
      this.current = {
        sequence: parsed.sequence,
        expectedLength,
        data: Buffer.from(parsed.data),
        parts: 1,
      }
      this.statsValue.lastExpectedLength = expectedLength
    } else {
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
    }

    if (!this.current || this.current.data.length < this.current.expectedLength) return null

    const pending = this.current
    this.current = null
    if (pending.data.length !== pending.expectedLength) {
      this.statsValue.overrunMessages += 1
      return null
    }

    const data = Buffer.from(pending.data)
    const nalTypes = annexBNalTypes(data)
    const nalTypeSet = new Set(nalTypes)
    for (const type of nalTypes) {
      const key = String(type)
      this.statsValue.nalTypeCounts[key] = (this.statsValue.nalTypeCounts[key] ?? 0) + 1
    }
    if (nalTypeSet.has(32)) this.statsValue.accessUnitsWithVps += 1
    if (nalTypeSet.has(33)) this.statsValue.accessUnitsWithSps += 1
    if (nalTypeSet.has(34)) this.statsValue.accessUnitsWithPps += 1
    if (nalTypes.some((type) => type >= 16 && type <= 21)) this.statsValue.accessUnitsWithIdr += 1
    this.statsValue.completedMessages += 1
    this.statsValue.completedBytes += data.length

    const unit: DjiPreviewAccessUnit = {
      data,
      sequence: pending.sequence,
      expectedLength: pending.expectedLength,
      actualLength: pending.data.length,
      parts: pending.parts,
      nalTypes,
    }
    this.onAccessUnit(unit)
    return unit
  }

  private dropPartial(reason: 'overrun' | 'short-first-fragment' | 'new-first-fragment' | 'sequence'): void {
    if (!this.current) return
    this.statsValue.droppedPartialMessages += 1
    this.current = null
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

  private trackSequence(sequence: number, packet: Buffer): boolean {
    if (!this.rememberSequence(sequence, packet)) return false
    if (this.lastSequence != null) {
      const delta = sequenceDelta(this.lastSequence, sequence)
      if (delta === 0) {
        this.statsValue.duplicatePackets += 1
        return false
      }
      if (delta >= 0x8000) {
        this.statsValue.outOfOrderPackets += 1
        if (this.strictSequence) this.dropPartial('sequence')
        return false
      }
      if (delta !== 8) {
        this.statsValue.sequenceGaps += 1
        if (delta % 8 === 0) this.statsValue.nonAdjacentSequenceSlots += Math.max(0, (delta / 8) - 1)
        if (this.strictSequence) this.dropPartial('sequence')
      }
    }
    this.lastSequence = sequence
    return true
  }
}
