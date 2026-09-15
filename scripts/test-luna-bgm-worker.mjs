#!/usr/bin/env node
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { promisify } from 'node:util'

import { ensureBgmAssets } from './copy-bgm-assets.mjs'

const execFileAsync = promisify(execFile)
const root = path.resolve(import.meta.dirname, '..')
const resourceRoot = path.join(root, 'resources', 'bgm')
const worker = path.join(root, 'luna-render-core', process.platform === 'win32' ? 'luna-bgm-worker.exe' : 'luna-bgm-worker')
const tempDir = await mkdtemp(path.join(os.tmpdir(), 'luna-bgm-worker-test-'))
const dslPath = path.join(tempDir, 'test.bgm')
const wavPath = path.join(tempDir, 'test.wav')

try {
  await ensureBgmAssets({ rootDir: root })
  await writeFile(dslPath, `bgm 1
dur 2
bpm 120
ts 4/4
sec main 2
  ch C G Am F
  t p c0 i89 v28 m
    p w c d4
  t b c1 i38 v46 l
    p q r 5 r 5 d.65
  t d c9 v52
    p q kick snare kick snare d.12
`, 'utf8')

  const result = await execFileAsync(worker, ['render', '--dsl', dslPath, '--output', wavPath], {
    env: { ...process.env, BGM_PROJECT_ROOT: resourceRoot },
    timeout: 30_000,
    windowsHide: true,
  })
  const payload = JSON.parse(result.stdout.trim())
  assert.equal(payload.duration_seconds, 2)
  const wav = await readFile(wavPath)
  assert.equal(wav.toString('ascii', 0, 4), 'RIFF')
  assert.equal(wav.toString('ascii', 8, 12), 'WAVE')
  assert.ok(wav.byteLength > 44)
  console.log('Luna BGM worker test passed')
} finally {
  await rm(tempDir, { recursive: true, force: true })
}
