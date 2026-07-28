import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'
import { Buffer } from 'node:buffer'
import ts from 'typescript'

const execFileAsync = promisify(execFile)
const source = await readFile(new URL('../electron/dolbyVisionHvcc.ts', import.meta.url), 'utf8')
const bitrateSource = await readFile(new URL('../electron/dolbyVisionBitrate.ts', import.meta.url), 'utf8')
const compiled = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2022,
    importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
  },
}).outputText
const hvcc = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`)
const bitrateCompiled = ts.transpileModule(bitrateSource, {
  compilerOptions: {
    module: ts.ModuleKind.ES2020,
    target: ts.ScriptTarget.ES2022,
  },
}).outputText
const bitrate = await import(`data:text/javascript;base64,${Buffer.from(bitrateCompiled).toString('base64')}`)

assert.equal(bitrate.resolveDolbyVisionBitrate('120000000', '125000000'), 120_000_000, 'video stream bitrate takes priority')
assert.equal(bitrate.resolveDolbyVisionBitrate(undefined, '125000000'), 125_000_000, 'container bitrate is used when the video stream omits bitrate')
assert.equal(bitrate.resolveDolbyVisionBitrate('N/A', '90000000'), 90_000_000, 'invalid stream bitrate falls back to container bitrate')
assert.equal(bitrate.resolveDolbyVisionBitrate(undefined, undefined), 40_000_000, 'missing bitrate uses the safe default')

const projectRoot = path.resolve(import.meta.dirname, '..')
const executableExtension = process.platform === 'win32' ? '.exe' : ''
const ffmpeg = path.join(projectRoot, 'node_modules', 'ffmpeg-static', `ffmpeg${executableExtension}`)
const mp4mux = path.join(projectRoot, 'resources', 'dolby-vision', `mp4mux${executableExtension}`)
const testDirectory = await mkdtemp(path.join(tmpdir(), 'luna-dolby-hvcc-test-'))
const hevcPath = path.join(testDirectory, 'main10.hevc')
const mp4Path = path.join(testDirectory, 'main10.mp4')

try {
  await execFileAsync(ffmpeg, [
    '-v', 'error',
    '-f', 'lavfi',
    '-i', 'testsrc2=size=320x180:rate=30000/1001',
    '-t', '0.2',
    '-pix_fmt', 'yuv420p10le',
    '-c:v', 'libx265',
    '-profile:v', 'main10',
    '-x265-params', 'bframes=0:log-level=error',
    '-f', 'hevc',
    hevcPath,
  ])
  await execFileAsync(mp4mux, [
    '--track', `h265:${hevcPath}#frame_rate=29.97002997,format=hvc1`,
    mp4Path,
  ])

  const sps = await hvcc.readHevcSpsConfiguration(hevcPath)
  assert.equal(sps.profileIdc, 2, 'encoded SPS declares Main 10 profile')
  assert.equal(sps.chromaFormat, 1, 'encoded SPS declares 4:2:0 chroma')
  assert.equal(sps.lumaBitDepth, 10, 'encoded SPS declares 10-bit luma')
  assert.equal(sps.chromaBitDepth, 10, 'encoded SPS declares 10-bit chroma')
  assert.ok(sps.numTemporalLayers >= 1, 'encoded SPS declares at least one temporal layer')

  const before = await hvcc.readHvccConfigurations(mp4Path)
  assert.equal(before.length, 1, 'Bento4 output contains one hvcC record')

  const repaired = await hvcc.repairHvccFromSps(mp4Path, sps)
  assert.equal(repaired.length, 1, 'repair updates one hvcC record')
  assert.equal(hvcc.hvccMatchesSps(repaired[0], sps), true, 'repaired hvcC matches the encoded SPS')
  assert.deepEqual(await hvcc.readHvccConfigurations(mp4Path), repaired, 'repaired hvcC persists on disk')
} finally {
  await rm(testDirectory, { recursive: true, force: true })
}

console.log('Dolby Vision hvcC tests passed')
