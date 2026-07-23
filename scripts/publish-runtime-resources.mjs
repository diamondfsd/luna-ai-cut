#!/usr/bin/env node
import process from 'node:process'
import {
  buildRuntimeResourceRelease,
  publishRuntimeResourceRelease,
  RESOURCE_RELEASE_TAG,
} from './runtime-resource-packs.mjs'

const upload = process.argv.includes('--upload')
const build = buildRuntimeResourceRelease()

console.log(`[runtime-resources] ${RESOURCE_RELEASE_TAG}`)
for (const pack of build.packs) {
  console.log(`[runtime-resources] ${pack.fileName}: ${pack.archiveBytes} bytes, ${pack.files.length} files, sha256 ${pack.sha256}`)
}
console.log(`[runtime-resources] manifest: ${build.manifestPath}`)

if (upload) {
  const result = await publishRuntimeResourceRelease(build)
  for (const asset of result.verified) {
    console.log(`[runtime-resources] verified ${asset.name}: ${asset.bytes} bytes, sha256 ${asset.sha256}`)
    console.log(`[runtime-resources] ${asset.url}`)
  }
  console.log(`[runtime-resources] release: ${result.releaseUrl}`)
}
