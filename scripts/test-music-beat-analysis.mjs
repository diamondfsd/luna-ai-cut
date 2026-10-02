import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
const execFileAsync = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const directory = await mkdtemp(path.join(tmpdir(), 'luna-music-beats-'))
const sampleRate = 44100
function audioBuffer(samples) {
  return { sampleRate, duration: samples.length / sampleRate, getChannelData: () => samples }
}
function groove(withHats) {
  const samples = new Float32Array(16 * sampleRate)
  for (let index = 0; index < samples.length; index++) {
    samples[index] = 0.1 * Math.sin(2 * Math.PI * 220 * index / sampleRate)
  }
  for (let time = 0.125; time < 16; time += withHats ? 0.25 : 0.5) {
    const beat = Math.round((time - 0.125) / 0.25)
    const amplitude = !withHats || beat % 2 === 0 ? 0.65 : 0.16
    const start = Math.round(time * sampleRate)
    for (let offset = 0; offset < sampleRate * 0.12 && start + offset < samples.length; offset++) {
      const seconds = offset / sampleRate
      samples[start + offset] += amplitude * Math.exp(-seconds / 0.025) * Math.sin(2 * Math.PI * 130 * seconds)
    }
  }
  return samples
}
try {
  // Exercise the shipped browser WASM path, not only the Node JS fallback.
  const shippedWasm = await readFile(path.join(root, 'vendor/openreel/packages/core/src/wasm/beat-detection/build/beat.wasm'))
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => new Response(shippedWasm)
  const output = path.join(directory, 'beat-engine.mjs')
  await build({
    entryPoints: [path.join(root, 'vendor/openreel/packages/core/src/audio/beat-detection-engine.ts')],
    outfile: output, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent',
  })
  const { BeatDetectionEngine } = await import(pathToFileURL(output).href)
  const engine = new BeatDetectionEngine()
  // The asynchronous loader must finish before testing browser-equivalent use.
  await engine.initWasm()
  globalThis.fetch = originalFetch
  for (const withHats of [false, true]) {
    const result = await engine.analyzeAudioBuffer(audioBuffer(groove(withHats)))
    console.log('synthetic groove:', { withHats, bpm: result.bpm, confidence: result.confidence, beats: result.beats.length })
    assert.ok(Math.abs(result.bpm - 120) <= 2, 'sustained harmony and eighth-note hats must not hide the 120 BPM pulse')
    assert.ok(result.confidence > 0.65)
    assert.ok(result.beats.some(beat => Math.abs(beat.time - 4.125) < 0.06))
  }
  for (const samples of [new Float32Array(441), new Float32Array(4 * sampleRate)]) {
    const result = await engine.analyzeAudioBuffer(audioBuffer(samples))
    assert.equal(result.confidence, 0)
    assert.deepEqual(result.beats, [], 'silence and short audio must not manufacture a default beat grid')
    assert.deepEqual(result.downbeats, [])
  }
  const wavPath = path.join(directory, 'montage.wav')
  const worker = path.join(root, 'luna-render-core', process.platform === 'win32' ? 'luna-bgm-worker.exe' : 'luna-bgm-worker')
  await execFileAsync(worker, ['render', '--dsl', path.join(root, 'resources/bgm/templates/rhythmic-montage.bgm'), '--output', wavPath], {
    env: { ...process.env, BGM_PROJECT_ROOT: path.join(root, 'resources/bgm') }, timeout: 30000,
  })
  const wav = await readFile(wavPath)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.readUInt32LE(24), sampleRate)
  const samples = new Float32Array((wav.length - 44) / 4)
  for (let index = 0; index < samples.length; index++) samples[index] = wav.readInt16LE(44 + index * 4) / 32768
  const result = await engine.analyzeAudioBuffer(audioBuffer(samples))
  console.log('rendered montage:', { bpm: result.bpm, confidence: result.confidence, beats: result.beats.length })
  assert.ok(Math.abs(result.bpm - 120) <= 3, 'the actual layered soundtrack must provide a usable beat grid')
  assert.ok(result.confidence > 0.5)
  assert.equal(result.duration, 24)
  console.log('music beat analysis regression: ok')
} finally {
  await rm(directory, { recursive: true, force: true })
}
