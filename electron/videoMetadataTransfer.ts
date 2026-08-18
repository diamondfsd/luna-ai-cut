export interface ProbeStream {
  codec_type?: string
  tags?: Record<string, string>
  disposition?: Record<string, number>
  color_range?: string
  color_space?: string
  color_transfer?: string
  color_primaries?: string
  chroma_location?: string
  side_data_list?: Array<Record<string, unknown> & { side_data_type?: string }>
}

export interface ProbeMedia {
  streams?: ProbeStream[]
  chapters?: Array<Record<string, unknown>>
  format?: {
    tags?: Record<string, string>
  }
}

const STANDARD_MP4_TOP_LEVEL_BOXES = new Set([
  'ftyp', 'free', 'wide', 'skip', 'mdat', 'moov', 'moof', 'mfra',
  'sidx', 'styp', 'ssix', 'prft',
])

/**
 * Preserve vendor metadata boxes (for example Insta360's `inst` trailer) that
 * FFmpeg cannot expose as ordinary tags. Media atoms are intentionally omitted.
 */
export function extractOpaqueMp4Boxes(bytes: Buffer): Buffer | null {
  const boxes: Buffer[] = []
  let offset = 0
  while (offset + 8 <= bytes.length) {
    const size32 = bytes.readUInt32BE(offset)
    const type = bytes.subarray(offset + 4, offset + 8).toString('ascii')
    let headerSize = 8
    let boxSize = size32
    if (size32 === 1) {
      if (offset + 16 > bytes.length) break
      const extendedSize = bytes.readBigUInt64BE(offset + 8)
      if (extendedSize > BigInt(Number.MAX_SAFE_INTEGER)) break
      boxSize = Number(extendedSize)
      headerSize = 16
    } else if (size32 === 0) {
      boxSize = bytes.length - offset
    }
    if (boxSize < headerSize || offset + boxSize > bytes.length) break
    if (!STANDARD_MP4_TOP_LEVEL_BOXES.has(type)) boxes.push(bytes.subarray(offset, offset + boxSize))
    offset += boxSize
  }
  return boxes.length > 0 ? Buffer.concat(boxes) : null
}

export function tagValue(tags: Record<string, string> | undefined, key: string): string | undefined {
  if (!tags) return undefined
  const expected = key.toLowerCase()
  return Object.entries(tags).find(([name]) => name.toLowerCase() === expected)?.[1]
}

export function hasTag(media: ProbeMedia, key: string): boolean {
  return Boolean(
    tagValue(media.format?.tags, key)
      ?? media.streams?.some((stream) => tagValue(stream.tags, key)),
  )
}

function streamTypeIndex(streams: ProbeStream[], stream: ProbeStream): number {
  return streams
    .slice(0, streams.indexOf(stream) + 1)
    .filter((candidate) => candidate.codec_type === stream.codec_type)
    .length - 1
}

function dispositionFlags(disposition: Record<string, number> | undefined): string | null {
  if (!disposition) return null
  const flags = Object.entries(disposition)
    .filter(([, enabled]) => Number(enabled) === 1)
    .map(([name]) => name)
  return flags.length > 0 ? flags.join('+') : '0'
}

function streamSpecifier(type: string | undefined): string | null {
  switch (type) {
    case 'video': return 'v'
    case 'audio': return 'a'
    case 'subtitle': return 's'
    case 'data': return 'd'
    case 'attachment': return 't'
    default: return null
  }
}

export function appendSourceStreamMetadata(
  args: string[],
  sourceMedia: ProbeMedia | null,
  outputMedia: ProbeMedia | null,
): void {
  if (!sourceMedia || !outputMedia) return
  const sourceStreams = sourceMedia.streams ?? []
  const outputStreams = outputMedia.streams ?? []
  const streamTypes = [...new Set(sourceStreams.map((stream) => stream.codec_type).filter(Boolean))]

  for (const type of streamTypes) {
    const specifier = streamSpecifier(type)
    if (!specifier) continue
    const sourceOfType = sourceStreams.filter((stream) => stream.codec_type === type)
    const outputOfType = outputStreams.filter((stream) => stream.codec_type === type)
    const count = Math.min(sourceOfType.length, outputOfType.length)
    for (let index = 0; index < count; index += 1) {
      // Copy every tag belonging to the matching source track. Codec, duration,
      // dimensions and bitrate are deliberately not metadata and stay from output.
      args.push(`-map_metadata:s:${specifier}:${index}`, `1:s:${specifier}:${index}`)
      const disposition = dispositionFlags(sourceOfType[index].disposition)
      if (disposition) args.push(`-disposition:${specifier}:${index}`, disposition)

      // These fields are stored as stream properties rather than ordinary tags.
      // They describe the rendered output and are safe to retain for a same-source
      // composition, while codec and timing properties remain output-owned.
      const sourceStream = sourceOfType[index]
      const outputStream = outputOfType[index]
      if (type === 'video' && outputStream) {
        const videoIndex = streamTypeIndex(outputStreams, outputStream)
        const colorFields: Array<[keyof ProbeStream, string]> = [
          ['color_range', '-color_range'],
          ['color_space', '-colorspace'],
          ['color_transfer', '-color_trc'],
          ['color_primaries', '-color_primaries'],
          ['chroma_location', '-chroma_sample_location'],
        ]
        for (const [field, option] of colorFields) {
          const value = sourceStream[field]
          if (typeof value === 'string' && value.length > 0) {
            args.push(`${option}:v:${videoIndex}`, value)
          }
        }
      }
    }
  }
}

export function hasDolbyVisionConfiguration(media: ProbeMedia | null): boolean {
  return Boolean(media?.streams?.some((stream) => (
    stream.side_data_list ?? []
  ).some((sideData) => sideData.side_data_type?.toLowerCase().includes('dovi configuration'))))
}
