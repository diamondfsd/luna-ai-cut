#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import process from 'node:process'
import {
  buildRuntimeResourceRelease,
  inspectZip,
  RESOURCE_MANIFEST_NAME,
  sha256File,
} from './runtime-resource-packs.mjs'

const rootDir = process.cwd()
const tempDir = mkdtempSync(join(tmpdir(), 'luna-runtime-resources-'))

try {
  const first = buildRuntimeResourceRelease({ rootDir, outputDir: join(tempDir, 'first') })
  const second = buildRuntimeResourceRelease({ rootDir, outputDir: join(tempDir, 'second') })

  assert.equal(first.packs.length, 2)
  assert.deepEqual(
    first.packs.map((pack) => pack.sha256),
    second.packs.map((pack) => pack.sha256),
    '相同输入必须生成相同归档 SHA256',
  )
  assert.equal(sha256File(first.manifestPath), sha256File(second.manifestPath), '清单必须可复现')
  assert.equal(first.manifestPath.endsWith(RESOURCE_MANIFEST_NAME), true)

  const fontPack = first.packs.find((pack) => pack.kind === 'font')
  const lutPack = first.packs.find((pack) => pack.kind === 'lut')
  assert.ok(fontPack)
  assert.ok(lutPack)
  assert.equal(fontPack.files.length, 7, '字体包必须包含当前全部 7 个字体文件')
  assert.ok(fontPack.files.every((file) => file.path.startsWith('fonts/')))
  assert.ok(lutPack.files.every((file) => file.path.startsWith('luts/')))
  assert.deepEqual(inspectZip(fontPack.outputPath), fontPack.files.map((file) => file.path))
  assert.deepEqual(inspectZip(lutPack.outputPath), lutPack.files.map((file) => file.path))

  for (const pack of first.manifest.packs) {
    assert.match(pack.url, /^https:\/\/gitcode\.com\//)
    assert.equal(pack.files.length > 0, true)
    assert.match(pack.sha256, /^[a-f0-9]{64}$/)
  }

  console.log('runtime resource pack tests passed')
} finally {
  rmSync(tempDir, { recursive: true, force: true })
}
