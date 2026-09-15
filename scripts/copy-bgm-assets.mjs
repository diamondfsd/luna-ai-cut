#!/usr/bin/env node
import { createHash } from 'node:crypto'
import { copyFileSync, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs'
import { createRequire } from 'node:module'
import https from 'node:https'
import { dirname, join } from 'node:path'
import process from 'node:process'
import { fileURLToPath } from 'node:url'
import { pipeline } from 'node:stream/promises'
import { buildDependencyUrl } from './build-dependency-sources.mjs'

const require = createRequire(import.meta.url)
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const upstreamUrl = 'https://raw.githubusercontent.com/ad-si/GeneralUser/master/GeneralUser.sf2'
const downloadUrl = buildDependencyUrl('GeneralUser.sf2', upstreamUrl)
const expectedSha256 = 'f45b6b4a68b6bf3d792fcbb6d7de24dc701a0f89c5900a21ef3aaece993b839a'
const proxyUrl = process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy || ''
const proxyAgent = proxyUrl ? new (require('https-proxy-agent').HttpsProxyAgent)(proxyUrl) : undefined

function sha256(filePath) {
  return createHash('sha256').update(readFileSync(filePath)).digest('hex')
}

function get(url, redirects = 5) {
  return new Promise((resolve, reject) => {
    https.get(url, { agent: proxyAgent, headers: { 'User-Agent': 'Luna-AI-Cut-Build/1.0' } }, (response) => {
      if (response.statusCode >= 300 && response.statusCode < 400 && response.headers.location && redirects > 0) {
        response.resume()
        resolve(get(new URL(response.headers.location, url).href, redirects - 1))
        return
      }
      if (response.statusCode !== 200) {
        response.resume()
        reject(new Error(`download failed: HTTP ${response.statusCode}`))
        return
      }
      resolve(response)
    }).on('error', reject)
  })
}

export async function ensureBgmAssets({ rootDir = root } = {}) {
  const output = join(rootDir, 'resources', 'bgm', 'soundfonts', 'GeneralUser.sf2')
  mkdirSync(dirname(output), { recursive: true })

  const localSoundfont = process.env.LUNA_BGM_SOUNDFONT
  if (localSoundfont && existsSync(localSoundfont)) {
    copyFileSync(localSoundfont, output)
  }
  if (existsSync(output) && sha256(output) === expectedSha256) {
    console.log(`[bgm-assets] GeneralUser.sf2 ready: ${output}`)
    return output
  }

  const partial = `${output}.partial`
  rmSync(partial, { force: true })
  console.log(`[bgm-assets] downloading GeneralUser.sf2 from ${downloadUrl}`)
  await pipeline(await get(downloadUrl), createWriteStream(partial))
  const actual = sha256(partial)
  if (actual !== expectedSha256) {
    rmSync(partial, { force: true })
    throw new Error(`GeneralUser.sf2 SHA256 mismatch: expected ${expectedSha256}, got ${actual}`)
  }
  rmSync(output, { force: true })
  renameSync(partial, output)
  console.log(`[bgm-assets] GeneralUser.sf2 ready: ${output}`)
  return output
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await ensureBgmAssets()
}
