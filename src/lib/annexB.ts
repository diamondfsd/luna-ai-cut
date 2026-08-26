export type NalCodec = 'h264' | 'h265'

export interface AccessUnit {
  key: boolean
  data: Uint8Array
}

const START_CODE = new Uint8Array([0, 0, 0, 1])
const H265_VPS = 32
const H265_SPS = 33
const H265_PPS = 34
const H265_IRAP_MIN = 16
const H265_IRAP_MAX = 23
const H264_SPS = 7
const H264_PPS = 8
const H264_IDR = 5
const H264_NON_IDR = 1

export function splitNalUnits(bytes: Uint8Array): Uint8Array[] {
  const units: Uint8Array[] = []
  let from = -1
  for (let i = 0; i + 2 < bytes.length; i += 1) {
    if (bytes[i] !== 0 || bytes[i + 1] !== 0) continue
    const size = bytes[i + 2] === 1 ? 3 : bytes[i + 2] === 0 && bytes[i + 3] === 1 ? 4 : 0
    if (!size) continue
    if (from >= 0 && i > from) units.push(bytes.subarray(from, i))
    from = i + size
    i += size - 1
  }
  if (from >= 0 && bytes.length > from) units.push(bytes.subarray(from))
  return units
}

function unescapeRbsp(unit: Uint8Array): Uint8Array {
  const out = new Uint8Array(unit.length)
  let written = 0
  let zeros = 0
  for (const byte of unit) {
    if (zeros === 2 && byte === 0x03) {
      zeros = 0
      continue
    }
    out[written++] = byte
    zeros = byte === 0 ? zeros + 1 : 0
  }
  return out.subarray(0, written)
}

export function nalType(unit: Uint8Array, codec: NalCodec): number {
  if (unit.length === 0) return -1
  return codec === 'h265' ? (unit[0]! >> 1) & 0x3f : unit[0]! & 0x1f
}

export function detectCodec(units: Uint8Array[]): NalCodec | null {
  for (const unit of units) {
    if (unit.length === 0 || (unit[0]! & 0x80) !== 0) continue
    const h265 = (unit[0]! >> 1) & 0x3f
    if (h265 === H265_VPS || h265 === H265_SPS || h265 === H265_PPS) return 'h265'
    const h264 = unit[0]! & 0x1f
    if (h264 === H264_SPS || h264 === H264_PPS) return 'h264'
  }
  return null
}

const findSps = (units: Uint8Array[], codec: NalCodec) =>
  units.find((unit) => nalType(unit, codec) === (codec === 'h265' ? H265_SPS : H264_SPS))

function hex(value: number): string {
  return value.toString(16).padStart(2, '0')
}

function reverseBits32(value: number): number {
  let out = 0
  for (let bit = 0; bit < 32; bit += 1) out = ((out << 1) | ((value >>> bit) & 1)) >>> 0
  return out >>> 0
}

export function buildCodecString(units: Uint8Array[], codec: NalCodec): string | null {
  const raw = findSps(units, codec)
  if (!raw) return null
  const sps = unescapeRbsp(raw)
  if (codec === 'h264') {
    if (sps.length < 4) return null
    return `avc1.${hex(sps[1]!)}${hex(sps[2]!)}${hex(sps[3]!)}`
  }
  if (sps.length < 15) return null
  const profileByte = sps[3]!
  const profileSpace = (profileByte >> 6) & 0x03
  const tierFlag = (profileByte >> 5) & 0x01
  const profileIdc = profileByte & 0x1f
  const compatibility = ((sps[4]! << 24) | (sps[5]! << 16) | (sps[6]! << 8) | sps[7]!) >>> 0
  const constraints: string[] = []
  for (let i = 8; i < 14; i += 1) constraints.push(hex(sps[i]!).toUpperCase())
  while (constraints.length > 0 && constraints[constraints.length - 1] === '00') constraints.pop()
  const space = profileSpace === 0 ? '' : String.fromCharCode(64 + profileSpace)
  const tier = tierFlag === 0 ? 'L' : 'H'
  return [
    `hvc1.${space}${profileIdc}`,
    reverseBits32(compatibility).toString(16),
    `${tier}${sps[14]!}`,
    ...constraints,
  ].join('.')
}

function isVcl(type: number, codec: NalCodec): boolean {
  return codec === 'h265' ? type <= 31 : type === H264_IDR || type === H264_NON_IDR
}

function isKeyNal(type: number, codec: NalCodec): boolean {
  return codec === 'h265' ? type >= H265_IRAP_MIN && type <= H265_IRAP_MAX : type === H264_IDR
}

function startsPicture(unit: Uint8Array, codec: NalCodec): boolean {
  const offset = codec === 'h265' ? 2 : 1
  return unit.length > offset && (unit[offset]! & 0x80) !== 0
}

export function drainAccessUnits(units: Uint8Array[], codec: NalCodec): { access: AccessUnit[]; pending: Uint8Array[] } {
  const starts: number[] = []
  for (let i = 0; i < units.length; i += 1) {
    const unit = units[i]!
    if (isVcl(nalType(unit, codec), codec) && startsPicture(unit, codec)) starts.push(i)
  }
  if (starts.length < 2) return { access: [], pending: units }
  const cut = starts[starts.length - 1]!
  let from = cut
  while (from > 0 && !isVcl(nalType(units[from - 1]!, codec), codec)) from -= 1
  return { access: groupAccessUnits(units.slice(0, from), codec), pending: units.slice(from) }
}

export function groupAccessUnits(units: Uint8Array[], codec: NalCodec): AccessUnit[] {
  const access: AccessUnit[] = []
  let pending: Uint8Array[] = []
  let key = false
  let seenVcl = false
  const flush = () => {
    if (!seenVcl || pending.length === 0) return
    const size = pending.reduce((total, unit) => total + START_CODE.length + unit.length, 0)
    const data = new Uint8Array(size)
    let at = 0
    for (const unit of pending) {
      data.set(START_CODE, at)
      at += START_CODE.length
      data.set(unit, at)
      at += unit.length
    }
    access.push({ key, data })
    pending = []
    key = false
    seenVcl = false
  }
  for (const unit of units) {
    const type = nalType(unit, codec)
    if (isVcl(type, codec) && startsPicture(unit, codec) && seenVcl) flush()
    if (isVcl(type, codec)) {
      seenVcl = true
      if (isKeyNal(type, codec)) key = true
    }
    pending.push(unit)
  }
  flush()
  return access
}
