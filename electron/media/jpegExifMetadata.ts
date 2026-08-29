const EXIF_HEADER = Buffer.from('Exif\0\0', 'ascii')

interface TiffAccess {
  read16(offset: number): number
  read32(offset: number): number
  write16(offset: number, value: number): void
  write32(offset: number, value: number): void
}

export function jpegDimensions(bytes: Buffer): { width: number; height: number } | null {
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return null
  let offset = 2
  while (offset + 9 < bytes.length && bytes[offset] === 0xff) {
    const marker = bytes[offset + 1]
    if (marker === 0xda || marker === 0xd9) break
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2
      continue
    }
    const length = bytes.readUInt16BE(offset + 2)
    if (length < 2 || offset + 2 + length > bytes.length) break
    const isStartOfFrame = marker >= 0xc0 && marker <= 0xcf
      && ![0xc4, 0xc8, 0xcc].includes(marker)
    if (isStartOfFrame) {
      return {
        height: bytes.readUInt16BE(offset + 5),
        width: bytes.readUInt16BE(offset + 7),
      }
    }
    offset += 2 + length
  }
  return null
}

function tiffAccess(bytes: Buffer, tiffStart: number): TiffAccess | null {
  if (tiffStart + 8 > bytes.length) return null
  const byteOrder = bytes.subarray(tiffStart, tiffStart + 2).toString('ascii')
  if (byteOrder !== 'II' && byteOrder !== 'MM') return null
  const littleEndian = byteOrder === 'II'
  return {
    read16: (offset) => littleEndian ? bytes.readUInt16LE(offset) : bytes.readUInt16BE(offset),
    read32: (offset) => littleEndian ? bytes.readUInt32LE(offset) : bytes.readUInt32BE(offset),
    write16: (offset, value) => littleEndian ? bytes.writeUInt16LE(value, offset) : bytes.writeUInt16BE(value, offset),
    write32: (offset, value) => littleEndian ? bytes.writeUInt32LE(value, offset) : bytes.writeUInt32BE(value, offset),
  }
}

function patchIfdScalar(
  bytes: Buffer,
  tiffStart: number,
  ifdOffset: number,
  tag: number,
  value: number,
  access: TiffAccess,
): void {
  if (ifdOffset < tiffStart || ifdOffset + 2 > bytes.length) return
  const count = access.read16(ifdOffset)
  if (ifdOffset + 2 + count * 12 > bytes.length) return
  for (let index = 0; index < count; index += 1) {
    const entry = ifdOffset + 2 + index * 12
    if (access.read16(entry) !== tag || access.read32(entry + 4) !== 1) continue
    const type = access.read16(entry + 2)
    if (type === 3 && value <= 0xffff) access.write16(entry + 8, value)
    else if (type === 4) access.write32(entry + 8, value)
    return
  }
}

function ifdPointer(
  bytes: Buffer,
  tiffStart: number,
  ifdOffset: number,
  tag: number,
  access: TiffAccess,
): number | null {
  if (ifdOffset < tiffStart || ifdOffset + 2 > bytes.length) return null
  const count = access.read16(ifdOffset)
  if (ifdOffset + 2 + count * 12 > bytes.length) return null
  for (let index = 0; index < count; index += 1) {
    const entry = ifdOffset + 2 + index * 12
    if (access.read16(entry) === tag && access.read16(entry + 2) === 4 && access.read32(entry + 4) === 1) {
      return tiffStart + access.read32(entry + 8)
    }
  }
  return null
}

export function normalizeJpegExifSegment(exifSegment: Buffer, outputJpeg: Buffer): Buffer {
  const dimensions = jpegDimensions(outputJpeg)
  if (!dimensions || exifSegment.length < 18 || !exifSegment.subarray(4, 10).equals(EXIF_HEADER)) {
    return exifSegment
  }

  const normalized = Buffer.from(exifSegment)
  const tiffStart = 10
  const access = tiffAccess(normalized, tiffStart)
  if (!access || access.read16(tiffStart + 2) !== 0x002a) return exifSegment

  const ifd0 = tiffStart + access.read32(tiffStart + 4)
  patchIfdScalar(normalized, tiffStart, ifd0, 0x0112, 1, access)
  patchIfdScalar(normalized, tiffStart, ifd0, 0x0100, dimensions.width, access)
  patchIfdScalar(normalized, tiffStart, ifd0, 0x0101, dimensions.height, access)

  const exifIfd = ifdPointer(normalized, tiffStart, ifd0, 0x8769, access)
  if (exifIfd !== null) {
    patchIfdScalar(normalized, tiffStart, exifIfd, 0xa002, dimensions.width, access)
    patchIfdScalar(normalized, tiffStart, exifIfd, 0xa003, dimensions.height, access)
  }
  return normalized
}
