import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../electron/jpegExifMetadata.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2022 },
}).outputText
const metadata = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

function sourceExifSegment() {
  const tiff = Buffer.alloc(80)
  tiff.write('II', 0, 'ascii')
  tiff.writeUInt16LE(0x002a, 2)
  tiff.writeUInt32LE(8, 4)

  tiff.writeUInt16LE(2, 8)
  tiff.writeUInt16LE(0x0112, 10)
  tiff.writeUInt16LE(3, 12)
  tiff.writeUInt32LE(1, 14)
  tiff.writeUInt16LE(8, 18)
  tiff.writeUInt16LE(0x8769, 22)
  tiff.writeUInt16LE(4, 24)
  tiff.writeUInt32LE(1, 26)
  tiff.writeUInt32LE(38, 30)

  tiff.writeUInt16LE(2, 38)
  tiff.writeUInt16LE(0xa002, 40)
  tiff.writeUInt16LE(4, 42)
  tiff.writeUInt32LE(1, 44)
  tiff.writeUInt32LE(3840, 48)
  tiff.writeUInt16LE(0xa003, 52)
  tiff.writeUInt16LE(4, 54)
  tiff.writeUInt32LE(1, 56)
  tiff.writeUInt32LE(2160, 60)

  const payload = Buffer.concat([Buffer.from('Exif\0\0', 'ascii'), tiff])
  const segment = Buffer.alloc(payload.length + 4)
  segment[0] = 0xff
  segment[1] = 0xe1
  segment.writeUInt16BE(payload.length + 2, 2)
  payload.copy(segment, 4)
  return segment
}

function outputJpeg(width, height) {
  const sof = Buffer.from([
    0xff, 0xd8,
    0xff, 0xc0, 0x00, 0x11, 0x08,
    height >> 8, height & 0xff,
    width >> 8, width & 0xff,
    0x03, 0x01, 0x11, 0x00, 0x02, 0x11, 0x00, 0x03, 0x11, 0x00,
    0xff, 0xd9,
  ])
  return sof
}

const sourceExif = sourceExifSegment()
const normalized = metadata.normalizeJpegExifSegment(sourceExif, outputJpeg(2160, 3840))

assert.notStrictEqual(normalized, sourceExif, 'normalization returns a safe copy')
assert.equal(sourceExif.readUInt16LE(28), 8, 'source metadata remains unchanged')
assert.equal(normalized.readUInt16LE(28), 1, 'orientation is reset after pixels are rotated')
assert.equal(normalized.readUInt32LE(58), 2160, 'EXIF image width matches exported pixels')
assert.equal(normalized.readUInt32LE(70), 3840, 'EXIF image height matches exported pixels')

console.log('Export source metadata tests passed')
