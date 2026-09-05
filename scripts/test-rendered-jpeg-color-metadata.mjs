import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2022 },
}).outputText

const dataUrl = (source) => `data:text/javascript;base64,${Buffer.from(compile(source)).toString('base64')}`
const exifSource = await readFile(new URL('../electron/media/jpegExifMetadata.ts', import.meta.url), 'utf8')
const exifUrl = dataUrl(exifSource)
const hdrSource = (await readFile(new URL('../electron/media/jpegHdrMetadata.ts', import.meta.url), 'utf8'))
  .replace("from './jpegExifMetadata'", `from '${exifUrl}'`)
const hdrUrl = dataUrl(hdrSource)
const source = (await readFile(new URL('../electron/export/exportSourceMetadata.ts', import.meta.url), 'utf8'))
  .replace("from '../media/exifReader'", `from '${dataUrl('export function readMediaDeviceInfo() { return null }')}'`)
  .replace("from '../media/jpegExifMetadata'", `from '${exifUrl}'`)
  .replace("from '../media/jpegHdrMetadata'", `from '${hdrUrl}'`)
const metadata = await import(dataUrl(source))

function jpegSegment(marker, payload) {
  const segment = Buffer.alloc(payload.length + 4)
  segment[0] = 0xff
  segment[1] = marker
  segment.writeUInt16BE(payload.length + 2, 2)
  payload.copy(segment, 4)
  return segment
}

function sof0(width, height) {
  return jpegSegment(0xc0, Buffer.from([
    8,
    height >> 8, height & 0xff,
    width >> 8, width & 0xff,
    3,
    1, 0x11, 0,
    2, 0x11, 0,
    3, 0x11, 0,
  ]))
}

function minimalJpeg(width, height, body = Buffer.from([0x10, 0x20, 0x30])) {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]),
    sof0(width, height),
    jpegSegment(0xda, Buffer.from([3, 1, 0, 2, 0, 3, 0, 0])),
    body,
    Buffer.from([0xff, 0xd9]),
  ])
}

const icc = jpegSegment(0xe2, Buffer.from('ICC_PROFILE\0\x01\x01test-profile', 'ascii'))
const gainMapMarker = jpegSegment(0xe2, Buffer.from('urn:iso:std:iso:ts:21496:-1\0\0\0\0\0', 'ascii'))
const mpfMarker = jpegSegment(0xe2, Buffer.from('MPF\0synthetic-mpf', 'ascii'))
const sourcePrimary = Buffer.concat([
  Buffer.from([0xff, 0xd8]),
  icc,
  gainMapMarker,
  mpfMarker,
  sof0(4, 2),
  jpegSegment(0xda, Buffer.from([3, 1, 0, 2, 0, 3, 0, 0])),
  Buffer.from([0x10, 0x20, 0x30]),
  Buffer.from([0xff, 0xd9]),
])
const gainMapImage = minimalJpeg(4, 2, Buffer.from([0x40, 0x50, 0x60]))
const sourceJpeg = Buffer.concat([sourcePrimary, gainMapImage])
const outputJpeg = minimalJpeg(4, 2, Buffer.from([0x70, 0x80, 0x90]))

assert.equal(
  metadata.buildJpegSourceMetadata(sourceJpeg, outputJpeg),
  null,
  'rendered SDR exports do not inherit source ICC or HDR gain-map metadata',
)

const preserved = metadata.buildJpegSourceMetadata(sourceJpeg, outputJpeg, { preserveSourceColorMetadata: true })
assert.ok(preserved, 'source color metadata can still be preserved explicitly')
assert.equal(preserved.gainMapImage.compare(gainMapImage), 0, 'explicit HDR preservation keeps the gain-map image')
assert.equal(preserved.segments.length, 3, 'explicit HDR preservation keeps ICC, gain-map, and rebuilt MPF segments')

console.log('Rendered JPEG color metadata tests passed')
