import { wireFieldVarint } from './insta360TcpCodec'

export const FILE_LIST_PAGE_SIZE = 50
export const FILE_LIST_MAX_OFFSET = 5000

export function parseInsta360FilePaths(body: Buffer): string[] {
  const text = body.toString('utf8')
  const paths = new Set<string>()
  // eslint-disable-next-line no-control-regex
  for (const match of text.matchAll(/\/(?:storage_internal|sdcard|DCIM)[^\x00\n\r"'<>\s]+?\.(?:mp4|mov|lrv|jpg|jpeg|dng|insp|png|webp)/gi)) {
    paths.add(match[0])
  }
  return [...paths]
}

export function fileListBody(
  mediaType: number,
  offset: number,
  limit = FILE_LIST_PAGE_SIZE,
  cardLocation = 2,
): Buffer {
  const parts = [wireFieldVarint(1, mediaType)]
  if (offset > 0) parts.push(wireFieldVarint(2, offset))
  parts.push(wireFieldVarint(3, limit), wireFieldVarint(4, cardLocation))
  return Buffer.concat(parts)
}

