#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
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
  SUBTITLE_MODEL_MANIFEST_NAME,
  publishModelRelease,
  writeModelManifest,
} from './model-resource-release.mjs'

async function localReleaseConfig(rootDir) {
  const commonGitDir = execFileSync('git', ['rev-parse', '--git-common-dir'], { cwd: rootDir, encoding: 'utf8' }).trim()
  const primaryWorktreeRoot = path.dirname(path.resolve(rootDir, commonGitDir))
  const configPaths = [
    path.join(rootDir, 'scripts', 'deploy-release.conf'),
    path.join(primaryWorktreeRoot, 'scripts', 'deploy-release.conf'),
  ]
  let content = ''
  for (const configPath of configPaths) {
    content = await readFile(configPath, 'utf8').catch(() => '')
    if (content) break
  }
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
const subtitleOnly = process.argv.includes('--subtitle-only')
const subtitleModelIds = new Set([registry.SUBTITLE_ASR_MODEL.id, registry.SUBTITLE_VAD_MODEL.id])
const artifacts = buildModelArtifacts(registry).filter((artifact) => (
  !subtitleOnly || artifact.models.some((model) => subtitleModelIds.has(model.modelId))
))
let lastProgress = ''

async function existingManifestArtifacts() {
  const manifestUrl = `https://gitcode.com/${owner}/${repo}/releases/download/${MODEL_RELEASE_TAG}/${MODEL_RELEASE_TAG}.json`
  const response = await fetch(manifestUrl, { redirect: 'follow' })
  if (response.status === 404) return []
  if (!response.ok) throw new Error(`读取现有模型清单失败: HTTP ${response.status}`)
  const manifest = await response.json()
  if (!Array.isArray(manifest.artifacts)) throw new Error('现有模型清单格式无效')
  return manifest.artifacts
}

console.log(`[model-resources] ${MODEL_RELEASE_TAG}: ${artifacts.length} 个唯一模型文件${subtitleOnly ? '（仅字幕）' : ''}`)
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
const existingArtifacts = await existingManifestArtifacts()
const currentFileNames = new Set(artifacts.map((artifact) => artifact.fileName))
const manifestArtifacts = [
  ...existingArtifacts.filter((artifact) => !currentFileNames.has(artifact.fileName)),
  ...artifacts,
]
const { manifestPath } = await writeModelManifest(
  manifestArtifacts,
  outputDir,
  owner,
  repo,
  subtitleOnly ? SUBTITLE_MODEL_MANIFEST_NAME : undefined,
)
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
