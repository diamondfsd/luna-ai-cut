export interface DjiPocketVideoFormat {
  resolution: number
  frameRate: number
}

export interface DjiPocketSubscribePush {
  name: string
  value: Buffer
}

/** Parse the camera -> app payload used by `0x00/0x99` status subscriptions. */
export function parseDjiPocketSubscribePush(payload: Uint8Array): DjiPocketSubscribePush | null {
  if (payload.length < 24 || payload[0] !== 0x02 || payload[1] !== 0x06) return null
  const nameLength = payload[13]! | (payload[14]! << 8)
  if (nameLength <= 0 || nameLength >= 80 || 15 + nameLength + 8 > payload.length) return null

  const name = Buffer.from(payload.subarray(15, 15 + nameLength)).toString('utf8')
  if (!name) return null
  const valueLengthOffset = 15 + nameLength + 6
  if (valueLengthOffset + 2 > payload.length) return null
  const valueLength = payload[valueLengthOffset]! | (payload[valueLengthOffset + 1]! << 8)
  const valueOffset = valueLengthOffset + 2
  if (valueOffset + valueLength > payload.length) return null
  return { name, value: Buffer.from(payload.subarray(valueOffset, valueOffset + valueLength)) }
}

export function parseDjiPocketVideoFormat(value: Uint8Array): DjiPocketVideoFormat | null {
  if (value.length < 2) return null
  return { resolution: value[0]!, frameRate: value[1]! }
}

/** Parse the `[count][resolution][fps][reserved]...` capability table. */
export function parseDjiPocketVideoFormats(value: Uint8Array): DjiPocketVideoFormat[] {
  if (value.length < 5 || value[0] !== 0x01) return []
  const innerLength = value[1]! | (value[2]! << 8)
  if (innerLength < 2 || 3 + innerLength > value.length) return []
  const body = value.subarray(3, 3 + innerLength)
  const count = body[0]!
  if (count < 1 || body.length < 1 + count * 3) return []

  const formats: DjiPocketVideoFormat[] = []
  const seen = new Set<string>()
  for (let index = 0; index < count; index += 1) {
    const offset = 1 + index * 3
    const format = parseDjiPocketVideoFormat(body.subarray(offset, offset + 2))
    if (!format) continue
    const key = `${format.resolution}:${format.frameRate}`
    if (seen.has(key)) continue
    seen.add(key)
    formats.push(format)
  }
  return formats
}

/** Pocket 3 normally boots in 4K and needs a different resolution to restart its encoder. */
export function djiPocketFirstPictureOriginal(format: DjiPocketVideoFormat | null): DjiPocketVideoFormat {
  return format ?? { resolution: 0x10, frameRate: 0x03 }
}

export function djiPocketFirstPictureKick(
  original: DjiPocketVideoFormat,
  available: readonly DjiPocketVideoFormat[] = [],
): DjiPocketVideoFormat {
  const naive: DjiPocketVideoFormat = {
    resolution: original.resolution === 0x10 ? 0x0a : 0x10,
    frameRate: original.frameRate,
  }
  const same = (left: DjiPocketVideoFormat, right: DjiPocketVideoFormat): boolean => (
    left.resolution === right.resolution && left.frameRate === right.frameRate
  )
  if (available.length === 0) return naive
  if (available.some((format) => same(format, naive))) return naive
  const sameFrameRate = available.find((format) => (
    format.frameRate === original.frameRate && format.resolution !== original.resolution
  ))
  if (sameFrameRate) return sameFrameRate
  const otherResolution = available.find((format) => format.resolution !== original.resolution)
  if (otherResolution) return otherResolution
  const other = available.find((format) => !same(format, original))
  return other ?? naive
}

export function djiPocketVideoFormatPayload(format: DjiPocketVideoFormat): Buffer {
  return Buffer.from([format.resolution & 0xff, format.frameRate & 0xff, 0x00, 0x00, 0x00])
}
