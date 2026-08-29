import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const compile = (source) => ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2022 },
}).outputText

const exifSource = await readFile(new URL('../electron/media/jpegExifMetadata.ts', import.meta.url), 'utf8')
const exifUrl = `data:text/javascript;base64,${Buffer.from(compile(exifSource)).toString('base64')}`
const hdrSource = (await readFile(new URL('../electron/media/jpegHdrMetadata.ts', import.meta.url), 'utf8'))
  .replace("from './jpegExifMetadata'", `from '${exifUrl}'`)
const hdr = await import(`data:text/javascript;base64,${Buffer.from(compile(hdrSource)).toString('base64')}`)

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
const source = Buffer.concat([sourcePrimary, gainMapImage, Buffer.from('camera-trailer')])
const output = minimalJpeg(4, 2, Buffer.from([0x70, 0x80, 0x90]))
const leading = [Buffer.from([0xff, 0xe1, 0, 6, 1, 2, 3, 4]), icc]
const metadata = hdr.buildJpegHdrMetadata(source, output, leading, 2)

assert.ok(metadata, 'MPF HDR metadata is detected')
assert.equal(metadata.gainMapImage.compare(gainMapImage), 0, 'only the embedded gain-map JPEG is copied')
assert.equal(hdr.extractJpegIccSegments(source).length, 1, 'source ICC segment is detected')
assert.equal(metadata.segments.length, 2, 'ISO gain-map marker and rebuilt MPF are emitted')

const result = Buffer.concat([output.subarray(0, 2), ...leading, ...metadata.segments, output.subarray(2), metadata.gainMapImage])
const primaryLength = result.length - metadata.gainMapImage.length
const mpf = metadata.segments[1]
const imageListOffset = 4 + 54
const secondImageStart = mpf.readUInt32BE(imageListOffset + 16 + 8)
assert.equal(hdr.extractJpegIccSegments(result).length, 1, 'ICC segment remains in the rebuilt primary JPEG')
assert.equal(mpf.readUInt32BE(imageListOffset + 4), primaryLength, 'MPF primary image length matches the rebuilt primary JPEG')
assert.equal(secondImageStart + 2 + leading.reduce((sum, segment) => sum + segment.length, 0) + metadata.segments[0].length + 8, primaryLength, 'MPF secondary image offset uses the MPF primary-image base')
assert.equal(result.subarray(primaryLength).compare(gainMapImage), 0, 'secondary image starts exactly at the MPF-declared boundary')
assert.equal(hdr.buildJpegHdrMetadata(source, minimalJpeg(8, 2), leading, 2), null, 'resized exports do not reuse a mismatched gain map')

console.log('JPEG HDR metadata tests passed')
