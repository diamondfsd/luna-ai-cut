import assert from 'node:assert/strict'
import { Buffer } from 'node:buffer'
import { readFile } from 'node:fs/promises'
import ts from 'typescript'

const source = await readFile(new URL('../electron/videoMetadataTransfer.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.ES2020, target: ts.ScriptTarget.ES2022 },
}).outputText
const metadata = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)

const sourceMedia = {
  format: { tags: { Location: '+31.2+121.4/', creation_time: '2026-08-09T11:10:13Z' } },
  streams: [
    {
      codec_type: 'video',
      color_range: 'tv',
      color_space: 'bt2020nc',
      color_transfer: 'smpte2084',
      color_primaries: 'bt2020',
      chroma_location: 'left',
      disposition: { default: 1 },
      tags: { handler_name: 'VideoHandler' },
      side_data_list: [{ side_data_type: 'DOVI configuration record' }],
    },
    {
      codec_type: 'audio',
      disposition: { default: 1 },
      tags: { language: 'und' },
    },
  ],
}
const outputMedia = { streams: [{ codec_type: 'video' }, { codec_type: 'audio' }] }
const args = []
metadata.appendSourceStreamMetadata(args, sourceMedia, outputMedia)

assert.equal(metadata.tagValue(sourceMedia.format.tags, 'location'), '+31.2+121.4/')
assert.equal(metadata.hasTag(sourceMedia, 'creation_time'), true)
assert.equal(metadata.hasDolbyVisionConfiguration(sourceMedia), true)
const standardBox = Buffer.alloc(12)
standardBox.writeUInt32BE(12, 0)
standardBox.write('free', 4, 'ascii')
const privateBox = Buffer.concat([Buffer.from([0, 0, 0, 16]), Buffer.from('inst', 'ascii'), Buffer.from('private!')])
assert.deepEqual(metadata.extractOpaqueMp4Boxes(Buffer.concat([standardBox, privateBox])), privateBox)
assert.deepEqual(args, [
  '-map_metadata:s:v:0', '1:s:v:0',
  '-disposition:v:0', 'default',
  '-color_range:v:0', 'tv',
  '-colorspace:v:0', 'bt2020nc',
  '-color_trc:v:0', 'smpte2084',
  '-color_primaries:v:0', 'bt2020',
  '-chroma_sample_location:v:0', 'left',
  '-map_metadata:s:a:0', '1:s:a:0',
  '-disposition:a:0', 'default',
])

console.log('Video metadata transfer tests passed')
