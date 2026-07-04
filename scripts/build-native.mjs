#!/usr/bin/env node
/**
 * 自动构建 Rust Native Core，增量编译 ~1s
 */
import { spawnSync } from 'node:child_process'
import { copyFileSync } from 'node:fs'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const rcDir = join(root, 'luna-render-core')

const platform = process.platform
const ext = platform === 'win32' ? '.dll' : platform === 'darwin' ? '.dylib' : '.so'
const libName = `libluna_render_core${ext}`

console.log('[build-native] cargo build...')
const build = spawnSync('cargo', ['build'], { cwd: rcDir, stdio: 'inherit' })
if (build.status !== 0) {
  console.error('[build-native] ❌ cargo build failed')
  process.exit(1)
}

const src = join(rcDir, 'target', 'debug', libName)
const dest = join(rcDir, 'luna-render-core.node')
copyFileSync(src, dest)
console.log('[build-native] ✅', dest)
