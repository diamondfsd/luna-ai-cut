export interface DjiManifestFile {
  path: string
  name: string
  thumbPath: string | null
  handle: number
  bytes: number | null
  extension: string
  durationSeconds?: number
  proxyPath?: string | null
  storageId: string
}

const MEDIA_EXTENSIONS = new Set(['MP4', 'MOV', 'JPG', 'JPEG', 'DNG', 'HEIC', 'OSV', 'INSV'])
const PROXY_EXTENSIONS = new Set(['LRF', 'LRV', 'XRF'])

function readPathField(bytes: Buffer, offset: number, subtype: number, prefix: string): { value: string; end: number } | null {
  if (offset + 6 > bytes.length || bytes[offset] !== 0x1a) return null
  const length = bytes[offset + 1]
  // CompositePack's length includes the six-byte field header, not the two-byte tag/length prefix.
  if (length < 6 || offset + length > bytes.length) return null
  if (bytes[offset + 2] !== 0 || bytes[offset + 3] !== 0 || bytes[offset + 4] !== 0 || bytes[offset + 5] !== subtype) return null
  const value = bytes.subarray(offset + 6, offset + length).toString('latin1')
  if (!value.startsWith(prefix) || !/^[\x20-\x7e]+$/.test(value)) return null
  return { value, end: offset + length }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : ''
}

function readUInt32LE(data: Buffer, offset: number): number | null {
  return offset >= 0 && offset + 4 <= data.length ? data.readUInt32LE(offset) : null
}

function readUInt16LE(data: Buffer, offset: number): number | null {
  return offset >= 0 && offset + 2 <= data.length ? data.readUInt16LE(offset) : null
}

function readFileField(data: Buffer, offset: number, base: string): { value: string; extension: string; end: number } | null {
  if (offset + 2 > data.length || data[offset] !== 0x0d) return null
  const length = data[offset + 1]
  const end = offset + 2 + length
  if (length <= base.length + 1 || end > data.length) return null
  const value = data.subarray(offset + 2, end).toString('latin1')
  if (!value.startsWith(`${base}.`) || !/^[\x20-\x7e]+$/.test(value)) return null
  const extension = extensionOf(value)
  if (!MEDIA_EXTENSIONS.has(extension) && !PROXY_EXTENSIONS.has(extension)) return null
  return { value, extension, end }
}

function findRecordMarker(data: Buffer, start: number, end: number): number {
  for (let offset = Math.max(0, start); offset + 4 <= end; offset += 1) {
    const kind = data[offset]
    const star = data[offset + 1]
    if ((kind === 0x03 || kind === 0x00) && (star === 0xff || star === 0xfe) &&
      data[offset + 2] === 0x19 && data[offset + 3] === 0x06) return offset
  }
  return -1
}

function fixedMediaTag(data: Buffer, pathOffset: number): number {
  const tag = pathOffset - 7
  return tag >= 0 && tag + 2 <= data.length && data[tag] === 0x19 && data[tag + 1] === 0x06 ? tag : -1
}

/** Parses the length-delimited CompositePack paths used by Osmosis. */
export function parseCompositeManifest(bytes: Uint8Array, storageId: string): DjiManifestFile[] {
  const data = Buffer.from(bytes)
  const paths: Array<{ offset: number; end: number; value: string }> = []
  for (let offset = 0; offset < data.length; offset += 1) {
    const field = readPathField(data, offset, 1, 'DCIM/')
    if (!field) continue
    paths.push({ offset, end: field.end, value: field.value })
    offset = field.end - 1
  }

  const seen = new Set<string>()
  return paths.flatMap((entry, index) => {
    const start = index > 0 ? paths[index - 1].end : 0
    const end = index + 1 < paths.length ? paths[index + 1].offset : data.length
    const pathName = entry.value.slice(entry.value.lastIndexOf('/') + 1)
    const pathExtension = extensionOf(pathName)
    const base = pathExtension ? pathName.slice(0, -(pathExtension.length + 1)) : pathName
    const window = data.subarray(start, end)
    let thumbPath: string | null = null
    for (let offset = 0; offset < window.length; offset += 1) {
      const field = readPathField(window, offset, 2, 'MISC/')
      const thumbBase = field?.value.replace(/\.(?:scr|thm)$/i, '')
      if (field && thumbBase?.endsWith(base)) {
        thumbPath = /\.(?:scr|thm)$/i.test(field.value) ? field.value : `${field.value}.scr`
        break
      }
    }

    let fileName = pathName
    let extension = pathExtension
    let proxyPath: string | null = null
    for (let offset = 0; offset < window.length - 1; offset += 1) {
      const field = readFileField(window, offset, base)
      if (!field) continue
      if (MEDIA_EXTENSIONS.has(field.extension)) {
        fileName = field.value
        extension = field.extension
      } else if (PROXY_EXTENSIONS.has(field.extension)) {
        proxyPath = `${entry.value}.${field.extension}`
      }
    }

    if (!extension) return []
    const path = pathExtension ? entry.value : `${entry.value}.${extension}`
    if (seen.has(path)) return []
    seen.add(path)

    const marker = findRecordMarker(data, start, end)
    // Most video records expose `03 ff 19 06`; still records on Pocket-family firmware can use a
    // different byte before the same `19 06` tag. The path has a stable relative position, so use it
    // as the bounded fallback instead of scanning into the next record.
    const mediaTag = marker >= 0 ? marker + 2 : fixedMediaTag(data, entry.offset)
    const handle = mediaTag >= 10 ? readUInt32LE(data, mediaTag - 10) ?? 0 : 0
    const bytesAtMarker = mediaTag >= 14 ? readUInt32LE(data, mediaTag - 14) : null
    const durationSeconds = marker >= 4 ? readUInt16LE(data, marker - 4) ?? 0 : 0
    const bytesForPhoto = bytesAtMarker
    return [{
      path,
      name: fileName.includes('.') ? fileName : `${base}.${extension}`,
      thumbPath,
      handle,
      bytes: bytesForPhoto,
      extension,
      durationSeconds,
      storageId,
      proxyPath,
    }]
  })
}

export function isPrimaryMedia(file: DjiManifestFile): boolean {
  return MEDIA_EXTENSIONS.has(file.extension)
}

export function isProxyMedia(file: DjiManifestFile): boolean {
  return PROXY_EXTENSIONS.has(file.extension)
}

export function mediaStem(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(0, dot) : name
}
