import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
const directory = await mkdtemp(path.join(tmpdir(), 'luna-analysis-regression-'))
const calls = []
let duration = 10
globalThis.__mediaAnalysisTest = {
  files: [{ mediaId: 'm1', name: 'camera.mp4', kind: 'video', filePath: '/test/camera.mp4' }],
  metadata: async () => [{ durationSec: duration }],
  execFile: () => {},
}
globalThis.__mediaAnalysisTest.execFile[promisify.custom] = async (_file, args) => {
  calls.push(args)
  return { stdout: Buffer.from('frame') }
}
try {
  const output = path.join(directory, 'analysis.mjs')
  await build({
    entryPoints: ['electron/features/ai-editor/aiEditorMediaAnalysisService.ts'],
    outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
    plugins: [{ name: 'analysis-boundaries', setup(builder) {
      const mocks = {
        'node:child_process': 'export const execFile = globalThis.__mediaAnalysisTest.execFile',
        aiEditorLocalMediaService: 'export const getAiEditorLocalMediaFiles = async () => globalThis.__mediaAnalysisTest.files',
        aiEditorMediaMetadataService: 'export const getAiEditorLocalMediaMetadata = (...args) => globalThis.__mediaAnalysisTest.metadata(...args)',
        pipeline: 'export const getFfmpegPath = () => "ffmpeg"',
      }
      builder.onResolve({ filter: /^node:child_process$|\/(aiEditorLocalMediaService|aiEditorMediaMetadataService|pipeline)$/ }, args => ({
        path: args.path === 'node:child_process' ? args.path : args.path.split('/').at(-1), namespace: 'mock',
      }))
      builder.onLoad({ filter: /.*/, namespace: 'mock' }, args => ({ contents: mocks[args.path], loader: 'js' }))
    } }],
  })
  const { inspectAiEditorLocalMedia } = await import(pathToFileURL(output).href)
  const detail = await inspectAiEditorLocalMedia(['m1'], { mode: 'detail' })
  assert.equal(detail.items[0].duration, 10)
  assert.deepEqual(detail.items[0].frames.map(frame => frame.timeSec), [1.5, 5, 8.5], 'missing catalog duration must not limit analysis to the first second')
  assert.deepEqual(calls.map(args => args[args.indexOf('-ss') + 1]), ['1.500', '5.000', '8.500'])
  const overview = await inspectAiEditorLocalMedia(['m1'])
  assert.equal(overview.items[0].frames[0].timeSec, 5)
  duration = 0
  calls.length = 0
  const invalid = await inspectAiEditorLocalMedia(['m1'], { mode: 'detail' })
  assert.match(invalid.items[0].error, /无法读取视频时长/)
  assert.deepEqual(invalid.items[0].frames, [])
  assert.equal(calls.length, 0, 'unknown duration must fail explicitly rather than produce misleading early frames')
  console.log('ai-editor media analysis regression: ok')
} finally {
  delete globalThis.__mediaAnalysisTest
  await rm(directory, { recursive: true, force: true })
}
