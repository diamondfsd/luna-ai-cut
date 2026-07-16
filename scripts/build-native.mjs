#!/usr/bin/env node
/**
 * 自动构建 Rust Native Core，支持交叉编译
 *
 * 默认构建当前主机平台。要交叉编译，设置 CROSS_TARGET：
 *
 *   CROSS_TARGET=x86_64-pc-windows-msvc pnpm build      # Win x64
 *   CROSS_TARGET=aarch64-apple-darwin  pnpm build        # macOS arm64
 *   CROSS_TARGET=x86_64-unknown-linux-gnu pnpm build     # Linux x64
 *
 * 要求：目标需通过 rustup 安装，如 rustup target add x86_64-pc-windows-msvc
 */
import { spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

const root = join(import.meta.dirname, '..')
const rcDir = join(root, 'luna-render-core')

// ── 确定目标平台 ──
const target = process.env.CROSS_TARGET || ''
const targetLower = target.toLowerCase()

// 从 target 推断平台；没有 target 则用当前主机
const isWin = targetLower.includes('windows') || (!target && process.platform === 'win32')
const isMac = targetLower.includes('apple-darwin') || (!target && process.platform === 'darwin')

const ext = isWin ? '.dll' : isMac ? '.dylib' : '.so'
const prefix = isWin ? '' : 'lib'
const libName = `${prefix}luna_render_core${ext}`

// ── 找到 Rust 工具链的 cargo ──
// rustup 安装的目标需要 rustup 管理的 cargo 才能识别
function resolveCargo() {
  // 优先用 rustup 工具链的 cargo（支持交叉编译目标）
  const rustupCargo = join(homedir(), '.rustup', 'toolchains', 'stable-aarch64-apple-darwin', 'bin', 'cargo')
  if (existsSync(rustupCargo)) return rustupCargo
  return 'cargo'
}

const cargoBin = resolveCargo()

// 使用 rustup 工具链时，强制指定同 toolchain 的 rustc（避免 PATH 中的 Homebrew rustc 干扰）
const rustcBin = cargoBin !== 'cargo'
  ? join(homedir(), '.rustup', 'toolchains', 'stable-aarch64-apple-darwin', 'bin', 'rustc')
  : undefined

// ── cargo build ──
const buildArgs = target ? ['build', '--release', '--target', target] : ['build', '--release']

console.log('[build-native] cargo build...', cargoBin, buildArgs.join(' '))
const build = spawnSync(cargoBin, buildArgs, {
  cwd: rcDir,
  stdio: 'inherit',
  env: { ...process.env, ...(rustcBin ? { RUSTC: rustcBin } : {}) },
})
if (build.status !== 0) {
  console.error('[build-native] ❌ cargo build failed')
  process.exit(1)
}

// ── 复制产物 ──
const src = target
  ? join(rcDir, 'target', target, 'release', libName)
  : join(rcDir, 'target', 'release', libName)

const dest = join(rcDir, 'luna-render-core.node')
copyFileSync(src, dest)
console.log('[build-native] ✅', dest)

for (const baseName of ['sam-segmentation-worker', 'semantic-segmentation-worker', 'specialized-segmentation-worker']) {
  const workerName = isWin ? `${baseName}.exe` : baseName
  const workerSrc = join(target ? join(rcDir, 'target', target, 'release') : join(rcDir, 'target', 'release'), workerName)
  const workerDest = join(rcDir, workerName)
  copyFileSync(workerSrc, workerDest)
  if (!isWin) chmodSync(workerDest, 0o755)
  console.log('[build-native] ✅', workerDest)
}

// ONNX Runtime 使用动态库。ort 的 copy-dylibs 会将目标平台运行库放到
// target/release，统一复制到 .node 同目录供开发与打包加载。
const artifactDir = target ? join(rcDir, 'target', target, 'release') : join(rcDir, 'target', 'release')
for (const fileName of readdirSync(artifactDir)) {
  if (!/^onnxruntime.*\.dll$/i.test(fileName) && !/^libonnxruntime.*\.(dylib|so)/i.test(fileName)) continue
  const runtimeDest = join(rcDir, fileName)
  copyFileSync(join(artifactDir, fileName), runtimeDest)
  console.log('[build-native] ✅', runtimeDest)
}
