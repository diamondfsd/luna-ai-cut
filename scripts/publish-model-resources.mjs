#!/usr/bin/env node
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  buildModelArtifacts,
  DEFAULT_GITCODE_OWNER,
  DEFAULT_GITCODE_REPO,
  downloadModelArtifacts,
  importCachedModelArtifacts,
  loadModelRegistry,
  MODEL_RELEASE_TAG,
  publishModelRelease,
  writeModelManifest,
} from './model-resource-release.mjs'

async function localReleaseConfig(rootDir) {
  const content = await readFile(path.join(rootDir, 'scripts', 'deploy-release.conf'), 'utf8').catch(() => '')
  return Object.fromEntries(content.split(/\r?\n/).flatMap((line) => {
    const match = /^\s*([A-Z][A-Z0-9_]*)=(.*)\s*$/.exec(line)
    if (!match) return []
    return [[match[1], match[2].trim().replace(/^(['"])(.*)\1$/, '$2')]]
  }))
}

const rootDir = process.cwd()
const config = await localReleaseConfig(rootDir)
const owner = process.env.GITCODE_OWNER ?? config.GITCODE_OWNER ?? DEFAULT_GITCODE_OWNER
const repo = process.env.GITCODE_REPO ?? config.GITCODE_REPO ?? DEFAULT_GITCODE_REPO
const token = process.env.GITCODE_TOKEN ?? config.GITCODE_TOKEN
const outputDir = path.join(rootDir, 'release', 'model-resources', MODEL_RELEASE_TAG)
const registry = await loadModelRegistry(rootDir)
const artifacts = buildModelArtifacts(registry)
let lastProgress = ''

console.log(`[model-resources] ${MODEL_RELEASE_TAG}: ${artifacts.length} 个唯一 ONNX 文件`)
await importCachedModelArtifacts(artifacts, outputDir, undefined, ({ artifact, cachedPath }) => {
  console.log(`[model-resources] imported ${artifact.fileName} from ${cachedPath}`)
})
await downloadModelArtifacts(artifacts, outputDir, ({ phase, artifact, completedBytes, totalBytes }) => {
  const percent = Math.floor(completedBytes / totalBytes * 10) * 10
  const key = `${phase}:${artifact.fileName}:${percent}`
  if (key === lastProgress) return
  lastProgress = key
  console.log(`[model-resources] ${phase} ${artifact.fileName} ${Math.min(100, percent)}%`)
})
const { manifestPath } = await writeModelManifest(artifacts, outputDir, owner, repo)
console.log(`[model-resources] manifest ${manifestPath}`)

if (process.argv.includes('--upload')) {
  const result = await publishModelRelease({
    artifacts,
    manifestPath,
    token,
    owner,
    repo,
    onProgress: ({ phase, upload }) => console.log(`[model-resources] ${phase} ${upload.fileName}`),
  })
  for (const item of result.verified) console.log(`[model-resources] verified ${item.fileName} ${item.bytes} bytes ${item.sha256}`)
  console.log(`[model-resources] release ${result.releaseUrl}`)
}
