export function buildRoutingHeader(
  sequence: number,
  counter: number,
  routingClass = 0,
  routingTail = 0,
): Buffer {
  const header = Buffer.alloc(12)
  // The routing ACK is the previous sequence in our own command window. Camera telemetry uses a
  // separate sequence space and must never be copied into this field.
  header.writeUInt16LE((sequence - 8) & 0xffff, 0)
  header.writeUInt16LE(sequence & 0xffff, 2)
  header[8] = counter & 0xff
  header[9] = 0x01
  header[10] = routingClass & 0xff
  header[11] = routingTail & 0xff
  return header
}

/** The reliable route/window prefix carries the camera channel in its first two bytes. */
export function cameraChannelFromPacket(packet: { packetType: number; payload: Uint8Array }): number | null {
  if (packet.packetType !== 0x01 && packet.packetType !== 0x02 && packet.packetType !== 0x03) return null
  if (packet.payload.length < 2) return null
  const channel = packet.payload[0]! | (packet.payload[1]! << 8)
  return channel === 0 ? null : channel
}

export function nextSequenceForCameraChannel(cameraChannel: number): number {
  return (cameraChannel + 8) & 0xffff
}

export function buildAckPayload(
  rxType2Sequence: number,
  rxType3Sequence: number,
  peerAckedTxSequence: number,
  lastTxSequence: number,
): Buffer {
  const group = (value: number): Buffer => {
    const result = Buffer.alloc(8)
    result.writeUInt16LE(value & 0xffff, 0)
    result.writeUInt16LE(value & 0xffff, 2)
    return result
  }
  return Buffer.concat([
    group(rxType2Sequence),
    group(rxType3Sequence),
    Buffer.from([
      peerAckedTxSequence & 0xff,
      (peerAckedTxSequence >>> 8) & 0xff,
      lastTxSequence & 0xff,
      (lastTxSequence >>> 8) & 0xff,
    ]),
    Buffer.alloc(6),
  ])
}
