export interface DjiManifestFile {
  path: string
  name: string
  thumbPath: string | null
  handle: number
  bytes: number | null
  extension: string
  storageId: string
}

const MEDIA_EXTENSIONS = new Set(['MP4', 'MOV', 'JPG', 'JPEG', 'DNG', 'HEIC', 'OSV', 'INSV'])
const PROXY_EXTENSIONS = new Set(['LRF', 'LRV', 'XRF'])

function readPathField(bytes: Buffer, offset: number, subtype: number, prefix: string): { value: string; end: number } | null {
  if (offset + 6 > bytes.length || bytes[offset] !== 0x1a) return null
  const length = bytes[offset + 1]
  if (length < 6 || offset + 2 + length > bytes.length) return null
  if (bytes[offset + 2] !== 0 || bytes[offset + 3] !== 0 || bytes[offset + 4] !== 0 || bytes[offset + 5] !== subtype) return null
  const value = bytes.subarray(offset + 6, offset + 2 + length).toString('latin1')
  if (!value.startsWith(prefix) || !/^[\x20-\x7e]+$/.test(value)) return null
  return { value, end: offset + 2 + length }
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toUpperCase() : ''
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
    if (seen.has(entry.value)) return []
    seen.add(entry.value)
    const start = index > 0 ? paths[index - 1].end : 0
    const end = index + 1 < paths.length ? paths[index + 1].offset : data.length
    const name = entry.value.slice(entry.value.lastIndexOf('/') + 1)
    const window = data.subarray(start, end)
    let thumbPath: string | null = null
    for (let offset = 0; offset < window.length; offset += 1) {
      const field = readPathField(window, offset, 2, 'MISC/')
      if (field && field.value.endsWith(name.slice(0, name.lastIndexOf('.') >= 0 ? name.lastIndexOf('.') : name.length))) {
        thumbPath = field.value
        break
      }
    }
    let handle = 0
    for (let offset = 0; offset + 12 <= window.length; offset += 1) {
      if ((window[offset] === 0x03 || window[offset] === 0x00) && (window[offset + 1] === 0xff || window[offset + 1] === 0xfe) &&
        window[offset + 2] === 0x19 && window[offset + 3] === 0x06 && offset >= 8) {
        handle = window.readUInt32LE(offset - 8)
        break
      }
    }
    const extension = extensionOf(name)
    return [{ path: entry.value, name, thumbPath, handle, bytes: null, extension, storageId }]
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

