#!/usr/bin/env node
/* eslint-env node */

import { copyFileSync, existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const openreelRoot = join(root, 'vendor', 'openreel')
const openreelDist = join(openreelRoot, 'apps', 'web', 'dist')

if (!existsSync(join(openreelRoot, 'package.json'))) {
  throw new Error('OpenReel 子模块未初始化，请执行 git submodule update --init --recursive')
}

if (!existsSync(join(openreelRoot, 'node_modules'))) {
  execFileSync('pnpm', ['install', '--frozen-lockfile'], {
    cwd: openreelRoot,
    stdio: 'inherit',
  })
}

execFileSync('pnpm', ['build'], {
  cwd: openreelRoot,
  env: { ...process.env, OPENREEL_DESKTOP: '1' },
  stdio: 'inherit',
})

if (!existsSync(join(openreelDist, 'index.html'))) {
  throw new Error('OpenReel 构建完成但缺少 apps/web/dist/index.html')
}

const serviceWorkerGuard = /window\.openreel\?\.platform==="desktop"\?null:([A-Za-z_$][\w$]*)\.register\(\)/
const assetDir = join(openreelDist, 'assets')
const serviceWorkerBundle = readdirSync(assetDir)
  .filter((fileName) => fileName.endsWith('.js'))
  .map((fileName) => join(assetDir, fileName))
  .find((filePath) => serviceWorkerGuard.test(readFileSync(filePath, 'utf8')))

if (!serviceWorkerBundle) {
  throw new Error('OpenReel 构建产物未找到 Service Worker 初始化入口，拒绝应用未验证补丁')
}

const bundle = readFileSync(serviceWorkerBundle, 'utf8')
const patchedBundle = bundle.replace(
  serviceWorkerGuard,
  (_match, managerName) => `window.openreel?.platform==="desktop"||window.location.protocol==="file:"?null:${managerName}.register()`,
)
if (patchedBundle === bundle) {
  throw new Error('OpenReel Service Worker 初始化入口未成功应用桌面补丁')
}
writeFileSync(serviceWorkerBundle, patchedBundle)

const bridgeFileName = 'luna-openreel-bridge.js'
copyFileSync(join(root, 'scripts', bridgeFileName), join(openreelDist, bridgeFileName))
const localeFileName = 'luna-openreel-locale.js'
copyFileSync(join(root, 'scripts', localeFileName), join(openreelDist, localeFileName))
const indexPath = join(openreelDist, 'index.html')
const originalIndex = readFileSync(indexPath, 'utf8')
let index = originalIndex.replace('<html lang="en">', '<html lang="zh-CN">')
const moduleScriptMarker = '<script type="module" crossorigin src='
if (!index.includes(moduleScriptMarker)) {
  throw new Error('OpenReel 构建产物未找到主模块脚本，拒绝注入 Luna 适配脚本')
}
const injectedScripts = [bridgeFileName, localeFileName]
  .filter((fileName) => !index.includes(`./${fileName}`))
  .map((fileName) => `<script src="./${fileName}"></script>`)
  .join('\n    ')
if (injectedScripts) {
  index = index.replace(moduleScriptMarker, `${injectedScripts}\n    ${moduleScriptMarker}`)
}
if (index !== originalIndex) {
  writeFileSync(indexPath, index)
}

console.log(`[build-openreel] ${openreelDist}`)
