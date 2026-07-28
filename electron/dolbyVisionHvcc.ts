import { open, type FileHandle } from 'node:fs/promises'

export interface HevcSpsConfiguration {
  profileIdc: number
  levelIdc: number
  chromaFormat: number
  lumaBitDepth: number
  chromaBitDepth: number
  numTemporalLayers: number
  temporalIdNested: number
}

export interface HvccConfiguration extends HevcSpsConfiguration {
  offset: number
}

interface Mp4Box {
  type: string
  offset: number
  size: number
  headerSize: number
}

class BitReader {
  private bitOffset = 0

  constructor(private readonly data: Uint8Array) {}

  readBits(count: number): number {
    if (count < 0 || count > 32 || this.bitOffset + count > this.data.length * 8) {
      throw new Error('HEVC SPS 数据不完整')
    }
    let value = 0
    for (let index = 0; index < count; index += 1) {
      const byte = this.data[this.bitOffset >> 3]
      value = value * 2 + ((byte >> (7 - (this.bitOffset & 7))) & 1)
      this.bitOffset += 1
    }
    return value
  }

  skipBits(count: number): void {
    while (count > 32) {
      this.readBits(32)
      count -= 32
    }
    this.readBits(count)
  }

  readUnsignedExpGolomb(): number {
    let leadingZeros = 0
    while (this.readBits(1) === 0) {
      leadingZeros += 1
      if (leadingZeros > 31) throw new Error('HEVC SPS Exp-Golomb 数据无效')
    }
    return (2 ** leadingZeros) - 1 + (leadingZeros > 0 ? this.readBits(leadingZeros) : 0)
  }
}

function removeEmulationPreventionBytes(data: Uint8Array): Uint8Array {
  const output: number[] = []
  for (let index = 0; index < data.length; index += 1) {
    if (index >= 2 && data[index] === 0x03 && data[index - 1] === 0x00 && data[index - 2] === 0x00) continue
    output.push(data[index])
  }
  return Uint8Array.from(output)
}

function parseProfileTierLevel(reader: BitReader, maxSubLayersMinus1: number): { profileIdc: number; levelIdc: number } {
  reader.skipBits(3)
  const profileIdc = reader.readBits(5)
  reader.skipBits(32)
  reader.skipBits(48)
  const levelIdc = reader.readBits(8)
  const subLayerProfilePresent: number[] = []
  const subLayerLevelPresent: number[] = []
  for (let index = 0; index < maxSubLayersMinus1; index += 1) {
    subLayerProfilePresent.push(reader.readBits(1))
    subLayerLevelPresent.push(reader.readBits(1))
  }
  if (maxSubLayersMinus1 > 0) {
    for (let index = maxSubLayersMinus1; index < 8; index += 1) reader.skipBits(2)
  }
  for (let index = 0; index < maxSubLayersMinus1; index += 1) {
    if (subLayerProfilePresent[index]) reader.skipBits(88)
    if (subLayerLevelPresent[index]) reader.skipBits(8)
  }
  return { profileIdc, levelIdc }
}

export function parseHevcSpsNalUnit(nalUnit: Uint8Array): HevcSpsConfiguration {
  if (nalUnit.length < 4 || ((nalUnit[0] >> 1) & 0x3f) !== 33) throw new Error('未找到有效的 HEVC SPS')
  const reader = new BitReader(removeEmulationPreventionBytes(nalUnit.subarray(2)))
  reader.skipBits(4)
  const maxSubLayersMinus1 = reader.readBits(3)
  const temporalIdNested = reader.readBits(1)
  const profileTierLevel = parseProfileTierLevel(reader, maxSubLayersMinus1)
  reader.readUnsignedExpGolomb()
  const chromaFormat = reader.readUnsignedExpGolomb()
  if (chromaFormat === 3) reader.skipBits(1)
  reader.readUnsignedExpGolomb()
  reader.readUnsignedExpGolomb()
  if (reader.readBits(1)) {
    reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
    reader.readUnsignedExpGolomb()
  }
  const lumaBitDepth = 8 + reader.readUnsignedExpGolomb()
  const chromaBitDepth = 8 + reader.readUnsignedExpGolomb()
  return {
    ...profileTierLevel,
    chromaFormat,
    lumaBitDepth,
    chromaBitDepth,
    numTemporalLayers: maxSubLayersMinus1 + 1,
    temporalIdNested,
  }
}

function startCodeLength(data: Uint8Array, offset: number): number {
  if (data[offset] !== 0 || data[offset + 1] !== 0) return 0
  if (data[offset + 2] === 1) return 3
  if (data[offset + 2] === 0 && data[offset + 3] === 1) return 4
  return 0
}

export async function readHevcSpsConfiguration(filePath: string): Promise<HevcSpsConfiguration> {
  const handle = await open(filePath, 'r')
  try {
    const stat = await handle.stat()
    const data = Buffer.alloc(Math.min(stat.size, 4 * 1024 * 1024))
    await handle.read(data, 0, data.length, 0)
    for (let offset = 0; offset < data.length - 6; offset += 1) {
      const prefixLength = startCodeLength(data, offset)
      if (!prefixLength) continue
      const nalOffset = offset + prefixLength
      if (((data[nalOffset] >> 1) & 0x3f) !== 33) continue
      let end = nalOffset + 2
      while (end < data.length - 4 && !startCodeLength(data, end)) end += 1
      return parseHevcSpsNalUnit(data.subarray(nalOffset, end))
    }
  } finally {
    await handle.close()
  }
  throw new Error('编码结果缺少 HEVC SPS')
}

async function readBox(handle: FileHandle, offset: number, end: number): Promise<Mp4Box | null> {
  if (offset + 8 > end) return null
  const header = Buffer.alloc(16)
  await handle.read(header, 0, Math.min(16, end - offset), offset)
  const size32 = header.readUInt32BE(0)
  const type = header.toString('ascii', 4, 8)
  const headerSize = size32 === 1 ? 16 : 8
  const size = size32 === 0 ? end - offset : size32 === 1 ? Number(header.readBigUInt64BE(8)) : size32
  if (!Number.isSafeInteger(size) || size < headerSize || offset + size > end) {
    throw new Error(`MP4 ${type} box 尺寸无效`)
  }
  return { type, offset, size, headerSize }
}

async function boxesInRange(handle: FileHandle, start: number, end: number): Promise<Mp4Box[]> {
  const boxes: Mp4Box[] = []
  let offset = start
  while (offset + 8 <= end) {
    const box = await readBox(handle, offset, end)
    if (!box) break
    boxes.push(box)
    offset += box.size
  }
  return boxes
}

const CONTAINER_TYPES = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl'])
const HEVC_SAMPLE_ENTRY_TYPES = new Set(['hvc1', 'hev1', 'dvh1', 'dvhe'])

async function findHvccBoxes(handle: FileHandle, start: number, end: number): Promise<Mp4Box[]> {
  const results: Mp4Box[] = []
  for (const box of await boxesInRange(handle, start, end)) {
    const payloadStart = box.offset + box.headerSize
    const boxEnd = box.offset + box.size
    if (box.type === 'hvcC') results.push(box)
    if (CONTAINER_TYPES.has(box.type)) results.push(...await findHvccBoxes(handle, payloadStart, boxEnd))
    if (box.type !== 'stsd' || payloadStart + 8 > boxEnd) continue

    const prefix = Buffer.alloc(8)
    await handle.read(prefix, 0, 8, payloadStart)
    const entryCount = prefix.readUInt32BE(4)
    let entryOffset = payloadStart + 8
    for (let index = 0; index < entryCount && entryOffset + 8 <= boxEnd; index += 1) {
      const entry = await readBox(handle, entryOffset, boxEnd)
      if (!entry) break
      if (HEVC_SAMPLE_ENTRY_TYPES.has(entry.type) && entry.size >= 86) {
        results.push(...await findHvccBoxes(handle, entry.offset + 86, entry.offset + entry.size))
      }
      entryOffset += entry.size
    }
  }
  return results
}

function parseHvccBytes(data: Uint8Array, offset: number): HvccConfiguration {
  if (data.length < 22 || data[0] !== 1) throw new Error('hvcC 配置记录无效')
  return {
    offset,
    profileIdc: data[1] & 0x1f,
    levelIdc: data[12],
    chromaFormat: data[16] & 0x03,
    lumaBitDepth: 8 + (data[17] & 0x07),
    chromaBitDepth: 8 + (data[18] & 0x07),
    numTemporalLayers: (data[21] >> 3) & 0x07,
    temporalIdNested: (data[21] >> 2) & 0x01,
  }
}

async function readHvccAt(handle: FileHandle, box: Mp4Box): Promise<{ bytes: Buffer; config: HvccConfiguration }> {
  if (box.size - box.headerSize < 22) throw new Error('hvcC 配置记录长度不足')
  const bytes = Buffer.alloc(22)
  const payloadOffset = box.offset + box.headerSize
  await handle.read(bytes, 0, bytes.length, payloadOffset)
  return { bytes, config: parseHvccBytes(bytes, payloadOffset) }
}

export async function readHvccConfigurations(filePath: string): Promise<HvccConfiguration[]> {
  const handle = await open(filePath, 'r')
  try {
    const boxes = await findHvccBoxes(handle, 0, (await handle.stat()).size)
    return await Promise.all(boxes.map(async (box) => (await readHvccAt(handle, box)).config))
  } finally {
    await handle.close()
  }
}

export async function repairHvccFromSps(filePath: string, expected: HevcSpsConfiguration): Promise<HvccConfiguration[]> {
  if (!Number.isInteger(expected.profileIdc) || expected.profileIdc < 0 || expected.profileIdc > 31
    || !Number.isInteger(expected.levelIdc) || expected.levelIdc < 0 || expected.levelIdc > 255
    || !Number.isInteger(expected.chromaFormat) || expected.chromaFormat < 0 || expected.chromaFormat > 3
    || !Number.isInteger(expected.lumaBitDepth) || expected.lumaBitDepth < 8 || expected.lumaBitDepth > 15
    || !Number.isInteger(expected.chromaBitDepth) || expected.chromaBitDepth < 8 || expected.chromaBitDepth > 15
    || !Number.isInteger(expected.numTemporalLayers) || expected.numTemporalLayers < 1 || expected.numTemporalLayers > 7
    || (expected.temporalIdNested !== 0 && expected.temporalIdNested !== 1)) {
    throw new Error('HEVC SPS 配置超出 hvcC 支持范围')
  }
  const handle = await open(filePath, 'r+')
  try {
    const boxes = await findHvccBoxes(handle, 0, (await handle.stat()).size)
    if (boxes.length === 0) throw new Error('Dolby Vision 输出缺少 hvcC 配置')
    const repaired: HvccConfiguration[] = []
    for (const box of boxes) {
      const { bytes, config } = await readHvccAt(handle, box)
      bytes[1] = (bytes[1] & 0xe0) | expected.profileIdc
      bytes[12] = expected.levelIdc
      bytes[16] = (bytes[16] & 0xfc) | expected.chromaFormat
      bytes[17] = (bytes[17] & 0xf8) | (expected.lumaBitDepth - 8)
      bytes[18] = (bytes[18] & 0xf8) | (expected.chromaBitDepth - 8)
      bytes[21] = (bytes[21] & 0xc3) | (expected.numTemporalLayers << 3) | (expected.temporalIdNested << 2)
      await handle.write(bytes, 0, bytes.length, config.offset)
      repaired.push(parseHvccBytes(bytes, config.offset))
    }
    return repaired
  } finally {
    await handle.close()
  }
}

export function hvccMatchesSps(actual: HvccConfiguration, expected: HevcSpsConfiguration): boolean {
  return actual.profileIdc === expected.profileIdc
    && actual.levelIdc === expected.levelIdc
    && actual.chromaFormat === expected.chromaFormat
    && actual.lumaBitDepth === expected.lumaBitDepth
    && actual.chromaBitDepth === expected.chromaBitDepth
    && actual.numTemporalLayers === expected.numTemporalLayers
    && actual.temporalIdNested === expected.temporalIdNested
}
