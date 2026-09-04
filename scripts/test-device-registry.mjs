#!/usr/bin/env node
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(projectRoot, relativePath), 'utf8'))
}

function pngDimensions(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'watermark must be a PNG')
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) }
}

const lunaPro = readJson('electron/devices/definitions/configs/luna-pro.json')
assert.equal(lunaPro.id, 'luna-pro')
assert.equal(lunaPro.name, 'Luna Pro')
assert.equal(lunaPro.protocol, 'insta360')
assert.equal(lunaPro.defaultHost, '192.168.42.1')
assert.equal(lunaPro.controlPort, 6666)
assert.deepEqual(lunaPro.wifi, { autoJoin: true, ssidIncludes: ['luna'] })
assert.deepEqual(lunaPro.watermarkStyles.map((style) => style.value), ['luna_pro_cn', 'luna_pro'])

const expectedWatermarks = [
  ['ic_watermark_luna_pro.png', 1020, 198, 'd3e3e1926348c384b4eaefbce9a380658d47aa86ec39ceb06da596f7753f4928'],
  ['ic_watermark_luna_pro_cn.png', 1201, 198, 'd101b19f6c6e24c25e90f503fc65bad23dffec4c592a74d38525d6d361c7465a'],
  ['ic_watermark_luna_pro_image.png', 1298, 252, 'df1194068a9e443d41626e832ac5a6ac113730c0cf1561d5f710bebc07ece08f'],
  ['ic_watermark_luna_pro_image_cn.png', 1529, 252, '71066ab0c0d96f0531d7664b9decca7bc9aa565186316770e933148eadb9d0ee'],
]
for (const [fileName, width, height, sha256] of expectedWatermarks) {
  const buffer = readFileSync(path.join(projectRoot, 'src/assets/watermark', fileName))
  assert.deepEqual(pngDimensions(buffer), { width, height }, `${fileName} dimensions changed`)
  assert.equal(createHash('sha256').update(buffer).digest('hex'), sha256, `${fileName} is not the extracted high-resolution asset`)
}

const sourceFiles = [
  ['electron/devices/definitions/deviceDefaults.ts', "case 'luna-pro':"],
  ['electron/devices/common/deviceProtocols.ts', "case 'luna-pro':"],
  ['electron/devices/common/cameraMediaSourceService.ts', 'this.ctx.lunaProtocol(definition.id)'],
  ['electron/devices/common/cameraVideoStreamService.ts', "definition.id === 'luna-pro'"],
]
for (const [relativePath, signature] of sourceFiles) {
  const source = readFileSync(path.join(projectRoot, relativePath), 'utf8')
  assert.ok(source.includes(signature), `missing Luna Pro registration: ${relativePath}`)
}

assert.equal(readJson('electron/devices/definitions/configs/pocket-4-pro.json').name, 'Osmo Pocket 4P')
assert.ok(readFileSync(path.join(projectRoot, 'electron/devices/dji/djiModels.ts'), 'utf8').includes("name: 'Osmo Pocket 4P'"))

console.log('Device registry and high-resolution watermark tests passed')
