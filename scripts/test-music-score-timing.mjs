import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createRequire } from 'node:module'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { pathToFileURL } from 'node:url'

const root = path.resolve(import.meta.dirname, '..')
const require = createRequire(import.meta.url)
const { build } = createRequire(require.resolve('vite/package.json'))('esbuild')
const directory = await mkdtemp(path.join(tmpdir(), 'luna-music-score-'))
const run = promisify(execFile)
try {
  const modulePath = path.join(directory, 'timing.mjs')
  await build({ entryPoints: [path.join(root, 'electron/features/music/musicScoreTiming.ts')], outfile: modulePath, bundle: true, platform: 'node', format: 'esm', logLevel: 'silent' })
  const { timingFromMidi, readGeneratedMusicTiming } = await import(pathToFileURL(modulePath).href)
  const worker = path.join(root, 'luna-render-core', process.platform === 'win32' ? 'luna-bgm-worker.exe' : 'luna-bgm-worker')
  const render = async (dsl, output) => run(worker, ['render', '--dsl', dsl, '--output', output, '--keep-midi'], { env: { ...process.env, BGM_PROJECT_ROOT: path.join(root, 'resources/bgm') }, timeout: 30000 })
  const wavPath = path.join(directory, 'montage.wav')
  await render(path.join(root, 'resources/bgm/templates/rhythmic-montage.bgm'), wavPath)
  const midi = await readFile(path.join(directory, 'montage.mid'))
  const timing = timingFromMidi(midi, 24)
  assert.equal(timing.bpm, 120)
  assert.deepEqual(timing.beatTimes.slice(0, 5), [0, 0.5, 1, 1.5, 2])
  assert.deepEqual(timing.downbeats.slice(0, 4), [0, 2, 4, 6])
  assert.equal(timing.beatTimes.length, 48)
  assert.ok(timing.percussionHits.some(hit => hit.pitch === 36 && hit.time === 2))
  const wav = await readFile(wavPath)
  // The strong rendered groove attack must be at the score beat, not +0.25s.
  const rms = (time) => {
    let sum = 0
    const start = Math.round(time * 44100)
    const frames = Math.round(0.035 * 44100)
    for (let index = start; index < start + frames; index++) sum += (wav.readInt16LE(44 + index * 4) / 32768) ** 2
    return Math.sqrt(sum / frames)
  }
  assert.ok(rms(2) > rms(2.25) * 1.25, 'the rendered primary attack must agree with MIDI phase')
  await writeFile(`${wavPath}.timing.json`, JSON.stringify(timing))
  assert.deepEqual(await readGeneratedMusicTiming(wavPath), timing)
  assert.equal(await readGeneratedMusicTiming(path.join(directory, 'external.wav')), undefined)
  assert.throws(() => timingFromMidi(midi.subarray(0, 25), 24))
  const alternateDsl = path.join(directory, 'three-four.bgm')
  await writeFile(alternateDsl, 'bgm 1\ndur 5\nbpm 90\nts 3/4\nsec main 3\n  ch C\n  t drums c9 v90\n    p q kick snare hat d.1\n')
  const alternate = path.join(directory, 'alternate.wav')
  await render(alternateDsl, alternate)
  const triple = timingFromMidi(await readFile(path.join(directory, 'alternate.mid')), 5)
  assert.ok(Math.abs(triple.beatTimes[1] - 2 / 3) < 0.00001)
  assert.ok(Math.abs(triple.downbeats[1] - 2) < 0.00001)
  console.log('Generated music score timing regression passed: exact MIDI phase, rendered attack, alternate tempo/meter, persistence')
} finally {
  await rm(directory, { recursive: true, force: true })
}
