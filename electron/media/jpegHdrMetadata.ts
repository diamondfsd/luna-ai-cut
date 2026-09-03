import { jpegDimensions } from './jpegExifMetadata'

const ICC_PROFILE_PREFIX = Buffer.from('ICC_PROFILE\0', 'ascii')
const HDR_GAIN_MAP_PREFIX = Buffer.from('urn:iso:std:iso:ts:21496:-1', 'ascii')
const MPF_PREFIX = Buffer.from('MPF\0', 'ascii')

interface JpegHeaderSegment {
  marker: number
  start: number
  end: number
  payload: Buffer
}

export interface JpegHdrMetadata {
  segments: Buffer[]
  gainMapImage: Buffer
}

function jpegHeaderSegments(bytes: Buffer): JpegHeaderSegment[] {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return []

  const segments: JpegHeaderSegment[] = []
  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return []
    let markerOffset = offset + 1
    while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset += 1
    if (markerOffset >= bytes.length) return []

    const marker = bytes[markerOffset]
    if (marker === 0xda) return segments
    if (marker === 0xd8 || marker === 0xd9) return []
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerOffset + 1
      continue
    }

    const segmentStart = offset
    const lengthOffset = markerOffset + 1
    if (lengthOffset + 2 > bytes.length) return []
    const length = bytes.readUInt16BE(lengthOffset)
    if (length < 2) return []
    const end = lengthOffset + length
    if (end > bytes.length) return []
    segments.push({
      marker,
      start: segmentStart,
      end,
      payload: bytes.subarray(lengthOffset + 2, end),
    })
    offset = end
  }
  return []
}

function firstJpegEnd(bytes: Buffer): number | null {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  const header = jpegHeaderSegments(bytes)
  if (header.length === 0) return null

  let offset = 2
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) {
      offset += 1
      continue
    }
    let markerOffset = offset + 1
    while (markerOffset < bytes.length && bytes[markerOffset] === 0xff) markerOffset += 1
    if (markerOffset >= bytes.length) return null
    const marker = bytes[markerOffset]
    if (marker === 0xd9) return markerOffset + 1
    if (marker === 0xda) {
      offset = markerOffset + 1
      while (offset + 1 < bytes.length) {
        if (bytes[offset] !== 0xff) {
          offset += 1
          continue
        }
        const next = bytes[offset + 1]
        if (next === 0x00 || (next >= 0xd0 && next <= 0xd7)) {
          offset += 2
          continue
        }
        if (next === 0xd9) return offset + 2
        offset += 1
      }
      return null
    }
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset = markerOffset + 1
      continue
    }
    if (markerOffset + 3 > bytes.length) return null
    const length = bytes.readUInt16BE(markerOffset + 1)
    if (length < 2) return null
    offset = markerOffset + length + 1
  }
  return null
}

function segmentWithPayload(marker: number, payload: Buffer): Buffer {
  const length = payload.length + 2
  if (length > 0xffff) throw new Error('JPEG metadata segment is too large')
  const segment = Buffer.alloc(payload.length + 4)
  segment[0] = 0xff
  segment[1] = marker
  segment.writeUInt16BE(length, 2)
  payload.copy(segment, 4)
  return segment
}

function buildMpfSegment(primaryLength: number, gainMapLength: number, gainMapStart: number): Buffer {
  if (primaryLength > 0xffffffff || gainMapLength > 0xffffffff) {
    throw new Error('JPEG MPF image is too large')
  }

  const payload = Buffer.alloc(86)
  payload.write('MPF\0', 0, 'ascii')
  payload.write('MM', 4, 'ascii')
  payload.writeUInt16BE(0x002a, 6)
  payload.writeUInt32BE(8, 8)
  payload.writeUInt16BE(3, 12)

  payload.writeUInt16BE(0xb000, 14)
  payload.writeUInt16BE(7, 16)
  payload.writeUInt32BE(4, 18)
  payload.write('0100', 22, 'ascii')

  payload.writeUInt16BE(0xb001, 26)
  payload.writeUInt16BE(4, 28)
  payload.writeUInt32BE(1, 30)
  payload.writeUInt32BE(2, 34)

  payload.writeUInt16BE(0xb002, 38)
  payload.writeUInt16BE(7, 40)
  payload.writeUInt32BE(32, 42)
  payload.writeUInt32BE(0x32, 46)

  const imageListOffset = 54
  payload.writeUInt32BE(0x00030000, imageListOffset)
  payload.writeUInt32BE(primaryLength, imageListOffset + 4)
  payload.writeUInt32BE(0, imageListOffset + 8)
  payload.writeUInt16BE(0, imageListOffset + 12)
  payload.writeUInt16BE(0, imageListOffset + 14)

  payload.writeUInt32BE(0, imageListOffset + 16)
  payload.writeUInt32BE(gainMapLength, imageListOffset + 20)
  payload.writeUInt32BE(gainMapStart, imageListOffset + 24)
  payload.writeUInt16BE(0, imageListOffset + 28)
  payload.writeUInt16BE(0, imageListOffset + 30)

  return segmentWithPayload(0xe2, payload)
}

export function extractJpegIccSegments(bytes: Buffer): Buffer[] {
  return jpegHeaderSegments(bytes)
    .filter((segment) => segment.marker === 0xe2 && segment.payload.subarray(0, ICC_PROFILE_PREFIX.length).equals(ICC_PROFILE_PREFIX))
    .map((segment) => Buffer.from(bytes.subarray(segment.start, segment.end)))
}

export function buildJpegHdrMetadata(
  sourceJpeg: Buffer,
  outputJpeg: Buffer,
  leadingSegments: Buffer[] = [],
  metadataInsertOffset = 2,
): JpegHdrMetadata | null {
  const sourceHeader = jpegHeaderSegments(sourceJpeg)
  const sourceMpf = sourceHeader.find((segment) => segment.marker === 0xe2 && segment.payload.subarray(0, MPF_PREFIX.length).equals(MPF_PREFIX))
  const gainMapMarker = sourceHeader.find((segment) => segment.marker === 0xe2 && segment.payload.subarray(0, HDR_GAIN_MAP_PREFIX.length).equals(HDR_GAIN_MAP_PREFIX))
  const sourceDimensions = jpegDimensions(sourceJpeg)
  const outputDimensions = jpegDimensions(outputJpeg)
  if (!sourceMpf || !gainMapMarker || !sourceDimensions || !outputDimensions) return null
  if (sourceDimensions.width !== outputDimensions.width || sourceDimensions.height !== outputDimensions.height) return null

  const sourceEnd = firstJpegEnd(sourceJpeg)
  if (sourceEnd === null || sourceEnd >= sourceJpeg.length) return null
  const gainMapEnd = firstJpegEnd(sourceJpeg.subarray(sourceEnd))
  if (gainMapEnd === null) return null
  const gainMapImage = Buffer.from(sourceJpeg.subarray(sourceEnd, sourceEnd + gainMapEnd))
  if (gainMapImage.length < 4 || gainMapImage[0] !== 0xff || gainMapImage[1] !== 0xd8 || gainMapImage[gainMapImage.length - 2] !== 0xff || gainMapImage[gainMapImage.length - 1] !== 0xd9) {
    return null
  }

  const mpfLength = 90
  const primaryLength = outputJpeg.length
    + leadingSegments.reduce((sum, segment) => sum + segment.length, 0)
    + gainMapMarker.end - gainMapMarker.start
    + mpfLength
  const mpfBaseOffset = metadataInsertOffset
    + leadingSegments.reduce((sum, segment) => sum + segment.length, 0)
    + gainMapMarker.end - gainMapMarker.start
    + 8
  // MPImageStart is relative to the MP primary image base at MPF APP2 + 8.
  const gainMapStart = primaryLength - mpfBaseOffset
  return {
    segments: [Buffer.from(sourceJpeg.subarray(gainMapMarker.start, gainMapMarker.end)), buildMpfSegment(primaryLength, gainMapImage.length, gainMapStart)],
    gainMapImage,
  }
}
