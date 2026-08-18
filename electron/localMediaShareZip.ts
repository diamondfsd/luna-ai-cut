import { createReadStream } from 'node:fs'
import type { ServerResponse } from 'node:http'

import type { ShareResourceRecord } from './localMediaShareServer'

const CRC32_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function updateCrc32(crc: number, chunk: Buffer): number {
  let value = crc ^ 0xffffffff
  for (const byte of chunk) value = CRC32_TABLE[(value ^ byte) & 0xff] ^ (value >>> 8)
  return (value ^ 0xffffffff) >>> 0
}

function zip64Extra(values: bigint[]): Buffer {
  const extra = Buffer.alloc(4 + values.length * 8)
  extra.writeUInt16LE(0x0001, 0)
  extra.writeUInt16LE(values.length * 8, 2)
  values.forEach((value, index) => extra.writeBigUInt64LE(value, 4 + index * 8))
  return extra
}

function zipFileName(name: string, usedNames: Set<string>): Buffer {
  const parsedName = name.replace(/\\/g, '/').split('/').pop() ?? ''
  const parsed = [...parsedName].map((character) => {
    const code = character.charCodeAt(0)
    return code <= 31 || code === 127 ? '_' : character
  }).join('').trim() || 'resource'
  const extensionIndex = parsed.lastIndexOf('.')
  const stem = extensionIndex > 0 ? parsed.slice(0, extensionIndex) : parsed
  const extension = extensionIndex > 0 ? parsed.slice(extensionIndex) : ''
  let candidate = parsed
  let suffix = 1
  while (usedNames.has(candidate)) {
    candidate = `${stem} (${suffix})${extension}`
    suffix += 1
  }
  usedNames.add(candidate)
  return Buffer.from(candidate, 'utf8')
}

function zipLocalHeader(name: Buffer, size: bigint, zip64: boolean): Buffer {
  const extra = zip64 ? zip64Extra([size, size]) : Buffer.alloc(0)
  const header = Buffer.alloc(30)
  header.writeUInt32LE(0x04034b50, 0)
  header.writeUInt16LE(zip64 ? 45 : 20, 4)
  header.writeUInt16LE(0x0808, 6)
  header.writeUInt16LE(0, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(0, 12)
  header.writeUInt32LE(0, 14)
  header.writeUInt32LE(zip64 ? 0xffffffff : 0, 18)
  header.writeUInt32LE(zip64 ? 0xffffffff : 0, 22)
  header.writeUInt16LE(name.length, 26)
  header.writeUInt16LE(extra.length, 28)
  return Buffer.concat([header, name, extra])
}

function zipDataDescriptor(crc: number, size: bigint, zip64: boolean): Buffer {
  const descriptor = Buffer.alloc(zip64 ? 24 : 16)
  descriptor.writeUInt32LE(0x08074b50, 0)
  descriptor.writeUInt32LE(crc >>> 0, 4)
  if (zip64) {
    descriptor.writeBigUInt64LE(size, 8)
    descriptor.writeBigUInt64LE(size, 16)
  } else {
    descriptor.writeUInt32LE(Number(size), 8)
    descriptor.writeUInt32LE(Number(size), 12)
  }
  return descriptor
}

function zipCentralHeader(name: Buffer, crc: number, size: bigint, offset: bigint, zip64: boolean): Buffer {
  const extra = zip64 ? zip64Extra([size, size, offset]) : Buffer.alloc(0)
  const header = Buffer.alloc(46)
  header.writeUInt32LE(0x02014b50, 0)
  header.writeUInt16LE((3 << 8) | (zip64 ? 45 : 20), 4)
  header.writeUInt16LE(zip64 ? 45 : 20, 6)
  header.writeUInt16LE(0x0808, 8)
  header.writeUInt16LE(0, 10)
  header.writeUInt16LE(0, 12)
  header.writeUInt16LE(0, 14)
  header.writeUInt32LE(crc >>> 0, 16)
  header.writeUInt32LE(zip64 ? 0xffffffff : Number(size), 20)
  header.writeUInt32LE(zip64 ? 0xffffffff : Number(size), 24)
  header.writeUInt16LE(name.length, 28)
  header.writeUInt16LE(extra.length, 30)
  header.writeUInt16LE(0, 32)
  header.writeUInt16LE(0, 34)
  header.writeUInt16LE(0, 36)
  header.writeUInt32LE(0, 38)
  header.writeUInt32LE(zip64 ? 0xffffffff : Number(offset), 42)
  return Buffer.concat([header, name, extra])
}

function zip64EndOfCentralDirectory(entryCount: bigint, centralSize: bigint, centralOffset: bigint): Buffer {
  const end = Buffer.alloc(56)
  end.writeUInt32LE(0x06064b50, 0)
  end.writeBigUInt64LE(44n, 4)
  end.writeUInt16LE(45, 12)
  end.writeUInt16LE(45, 14)
  end.writeUInt32LE(0, 16)
  end.writeUInt32LE(0, 20)
  end.writeBigUInt64LE(entryCount, 24)
  end.writeBigUInt64LE(entryCount, 32)
  end.writeBigUInt64LE(centralSize, 40)
  end.writeBigUInt64LE(centralOffset, 48)
  return end
}

function zip64Locator(endOffset: bigint): Buffer {
  const locator = Buffer.alloc(20)
  locator.writeUInt32LE(0x07064b50, 0)
  locator.writeUInt32LE(0, 4)
  locator.writeBigUInt64LE(endOffset, 8)
  locator.writeUInt32LE(1, 16)
  return locator
}

function zipEndOfCentralDirectory(entryCount: number, centralSize: bigint, centralOffset: bigint, zip64: boolean): Buffer {
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(0, 4)
  end.writeUInt16LE(0, 6)
  end.writeUInt16LE(zip64 ? 0xffff : entryCount, 8)
  end.writeUInt16LE(zip64 ? 0xffff : entryCount, 10)
  end.writeUInt32LE(zip64 ? 0xffffffff : Number(centralSize), 12)
  end.writeUInt32LE(zip64 ? 0xffffffff : Number(centralOffset), 16)
  end.writeUInt16LE(0, 20)
  return end
}

export async function streamZip(resources: ShareResourceRecord[], response: ServerResponse): Promise<void> {
  const usedNames = new Set<string>()
  const central: Buffer[] = []
  let zip64 = false
  let offset = 0n
  const writePart = async (part: Buffer): Promise<void> => {
    if (response.destroyed) throw new Error('下载连接已断开')
    if (!response.write(part)) {
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          response.off('drain', onDrain)
          response.off('close', onClose)
          response.off('error', onError)
        }
        const onDrain = () => {
          cleanup()
          resolve()
        }
        const onClose = () => {
          cleanup()
          reject(new Error('下载连接已断开'))
        }
        const onError = (error: Error) => {
          cleanup()
          reject(error)
        }
        response.once('drain', onDrain)
        response.once('close', onClose)
        response.once('error', onError)
      })
    }
    offset += BigInt(part.length)
  }

  for (const resource of resources) {
    const name = zipFileName(resource.name, usedNames)
    const localOffset = offset
    const expectedSize = BigInt(resource.size)
    const entryZip64 = expectedSize > 0xffffffffn || localOffset > 0xffffffffn
    zip64 ||= entryZip64
    await writePart(zipLocalHeader(name, expectedSize, entryZip64))
    let size = 0n
    let crc = 0
    const stream = createReadStream(resource.absolutePath)
    try {
      await new Promise<void>((resolve, reject) => {
        stream.on('data', (chunk: Buffer) => {
          stream.pause()
          const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
          crc = updateCrc32(crc, bytes)
          size += BigInt(bytes.length)
          void writePart(bytes).then(() => stream.resume(), reject)
        })
        stream.once('end', resolve)
        stream.once('error', reject)
      })
    } finally {
      stream.destroy()
    }
    await writePart(zipDataDescriptor(crc, size, entryZip64))
    central.push(zipCentralHeader(name, crc, size, localOffset, entryZip64))
  }

  const centralOffset = offset
  for (const entry of central) await writePart(entry)
  const centralSize = offset - centralOffset
  const endOffset = offset
  if (zip64 || central.length > 0xffff || centralSize > 0xffffffffn || centralOffset > 0xffffffffn) {
    await writePart(zip64EndOfCentralDirectory(BigInt(central.length), centralSize, centralOffset))
    await writePart(zip64Locator(endOffset))
    zip64 = true
  }
  await writePart(zipEndOfCentralDirectory(central.length, centralSize, centralOffset, zip64))
  response.end()
}
