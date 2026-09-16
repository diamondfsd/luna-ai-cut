/* global Buffer */
import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtemp, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { execFileSync } from 'node:child_process'
import { MockCameraServer } from '../dji_mock_server/server.mjs'
import { createDefaultPreviewSource } from '../dji_mock_server/previewSource.mjs'
import { DjiPreviewReassembler } from '../electron/devices/dji/djiPreview.ts'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')

test('DJI actual Pocket client receives a decodable default Mock preview', async (t) => {
  const ffmpeg = require('ffmpeg-static')
  const accessUnits = await createDefaultPreviewSource(ffmpeg)
  assert.equal(accessUnits.length, 25)
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0', '-f', 'null', '-'], {
    input: Buffer.concat(accessUnits), timeout: 10000,
  })
  const server = new MockCameraServer({ model: 'pocket4', host: '127.0.0.1', udpPort: 0, tcpPort: 0, httpPort: 0 })
  server.videoAUs = accessUnits
  server.log = () => {}
  await server.listen()
  const root = await mkdtemp(path.join(tmpdir(), 'luna-dji-client-preview-'))
  let client
  t.after(async () => {
    await client?.close()
    server.stop()
    await rm(root, { recursive: true, force: true })
  })
  // Only replace Electron/storage boundaries. Keep the actual session, UDP
  // transport, command encoders and preview startup sequence under test.
  const result = await build({
    entryPoints: ['electron/devices/dji/djiCameraSession.ts'],
    bundle: true, write: false, platform: 'node', format: 'cjs',
    plugins: [{ name: 'headless-dji-boundaries', setup(builder) {
      builder.onResolve({ filter: /\/(fileService|loggerService|mockServerService|djiWirelessPreparation)$/ }, (args) => ({ path: args.path.split('/').pop(), namespace: 'dji-test' }))
      builder.onLoad({ filter: /.*/, namespace: 'dji-test' }, (args) => {
        const modules = {
          fileService: 'export const getSettings = async () => ({}); export const saveSettings = async (value) => value;',
          loggerService: 'export const logMainDebug = () => {}; export const logMainInfo = () => {}; export const logMainWarn = () => {}; export const logMainError = () => {};',
          mockServerService: 'export const mockTcpPortForHost = () => ' + server.tcp.address().port + '; export const mockUdpPortForHost = () => ' + server.udp.address().port + ';',
          djiWirelessPreparation: 'export class DefaultDjiWirelessPreparation {}; export const waitForDjiHostReachable = async () => {};',
        }
        return { contents: modules[args.path], loader: 'js' }
      })
    } }],
  })
  const bundle = path.join(root, 'session.cjs')
  await writeFile(bundle, result.outputFiles[0].contents)
  const { DjiCameraSession } = require(bundle)
  client = new DjiCameraSession('dji-pocket-4', '127.0.0.1:' + server.http.address().port, 'mock-preview', {
    prepare: async () => ({ mode: 'manual', message: 'Mock' }), close: async () => {},
  })
  let resolveFrame
  let timer
  const frame = new Promise((resolve, reject) => {
    resolveFrame = resolve
    timer = setTimeout(() => reject(new Error('Actual DJI client received no complete Mock frame')), 5000)
  })
  t.after(() => clearTimeout(timer))
  const reassembler = new DjiPreviewReassembler((unit) => { clearTimeout(timer); resolveFrame(unit) }, true, true)
  client.subscribePreviewPackets((packet) => reassembler.feed(packet))
  await client.startPreview()
  const first = await frame
  assert.equal(first.codec, 'h264')
  assert.ok(first.actualLength > 0)
  execFileSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-f', 'h264', '-i', 'pipe:0', '-f', 'null', '-'], {
    input: first.data, timeout: 10000,
  })
  assert.equal(server.metrics.malformedPackets, 0)
  assert.equal(server.metrics.rejectedCommands, 0)
})
