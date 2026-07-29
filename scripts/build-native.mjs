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
import { dirname, join } from 'node:path'
import process from 'node:process'
import { prepareDxcRuntime } from './prepare-dxc.mjs'

const root = join(import.meta.dirname, '..')
const rcDir = join(root, 'luna-render-core')

// ── 确定目标平台 ──
const target = process.env.CROSS_TARGET || ''
const targetLower = target.toLowerCase()

// 从 target 推断平台；没有 target 则用当前主机
const isWin = targetLower.includes('windows') || (!target && process.platform === 'win32')
const isMac = targetLower.includes('apple-darwin') || (!target && process.platform === 'darwin')
const isMacX64 = isMac && (targetLower.includes('x86_64') || (!target && process.arch === 'x64'))
const targetArch = targetLower.includes('aarch64')
  ? 'arm64'
  : targetLower.includes('i686')
    ? 'ia32'
    : targetLower.includes('x86_64')
      ? 'x64'
      : process.arch

const ext = isWin ? '.dll' : isMac ? '.dylib' : '.so'
const prefix = isWin ? '' : 'lib'
const libName = `${prefix}luna_render_core${ext}`

if (isWin) {
  await prepareDxcRuntime({ rootDir: root, outputDir: rcDir, arch: targetArch })
}

function prepareMacArtifact(filePath, onnxRuntimePolicy) {
  if (!isMac || process.platform !== 'darwin') return

  const inspect = spawnSync('otool', ['-L', filePath], { encoding: 'utf8' })
  if (inspect.status !== 0) {
    console.error(`[build-native] ❌ otool failed: ${filePath}`)
    process.exit(1)
  }

  const linksOnnxRuntime = /libonnxruntime.*\.dylib/i.test(inspect.stdout)
  if (onnxRuntimePolicy === 'required' && !linksOnnxRuntime) {
    console.error(`[build-native] ❌ ONNX Runtime dependency missing: ${filePath}`)
    process.exit(1)
  }
  if (onnxRuntimePolicy === 'forbidden' && linksOnnxRuntime) {
    console.error(`[build-native] ❌ render core must not link ONNX Runtime: ${filePath}`)
    process.exit(1)
  }

  const onnxDependencies = inspect.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+\(/, 1)[0])
    .filter((dependency) => /^@rpath\/libonnxruntime.*\.dylib$/i.test(dependency))

  for (const dependency of onnxDependencies) {
    const fileName = dependency.slice(dependency.lastIndexOf('/') + 1)
    const relocatedDependency = `@loader_path/${fileName}`
    const relocate = spawnSync(
      'install_name_tool',
      ['-change', dependency, relocatedDependency, filePath],
      { stdio: 'inherit' },
    )
    if (relocate.status !== 0) {
      console.error(`[build-native] ❌ install_name_tool failed: ${filePath}`)
      process.exit(1)
    }
    console.log(`[build-native] ✅ ${filePath}: ${relocatedDependency}`)
  }

  const verify = spawnSync('otool', ['-L', filePath], { encoding: 'utf8' })
  if (verify.status !== 0 || /@rpath\/libonnxruntime.*\.dylib/i.test(verify.stdout)) {
    console.error(`[build-native] ❌ ONNX Runtime path verification failed: ${filePath}`)
    process.exit(1)
  }
  const missingRuntime = verify.stdout
    .split('\n')
    .map((line) => line.trim().split(/\s+\(/, 1)[0])
    .filter((dependency) => /^@loader_path\/libonnxruntime.*\.dylib$/i.test(dependency))
    .map((dependency) => join(dirname(filePath), dependency.slice(dependency.lastIndexOf('/') + 1)))
    .find((runtimePath) => !existsSync(runtimePath))
  if (missingRuntime) {
    console.error(`[build-native] ❌ ONNX Runtime library missing: ${missingRuntime}`)
    process.exit(1)
  }

  const sign = spawnSync('codesign', ['--force', '--sign', '-', filePath], { stdio: 'inherit' })
  if (sign.status !== 0) {
    console.error(`[build-native] ❌ codesign failed: ${filePath}`)
    process.exit(1)
  }
}

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

// ── 复制 ONNX Runtime ──
// ort 可能将运行库放在 target/release，也可能使用外部 ORT_LIB_LOCATION。
// 统一复制到 .node 同目录，供开发和打包加载。
const artifactDir = target ? join(rcDir, 'target', target, 'release') : join(rcDir, 'target', 'release')
const runtimeDirs = [...new Set([artifactDir, process.env.ORT_LIB_LOCATION].filter(Boolean))]
for (const runtimeDir of runtimeDirs) {
  if (!existsSync(runtimeDir)) continue
  for (const fileName of readdirSync(runtimeDir)) {
    if (!/^onnxruntime.*\.dll$/i.test(fileName) && !/^libonnxruntime.*\.(dylib|so)/i.test(fileName)) continue
    const runtimeDest = join(rcDir, fileName)
    copyFileSync(join(runtimeDir, fileName), runtimeDest)
    console.log('[build-native] ✅', runtimeDest)
  }
}

// ── 复制原生产物 ──
const src = target
  ? join(rcDir, 'target', target, 'release', libName)
  : join(rcDir, 'target', 'release', libName)

const dest = join(rcDir, 'luna-render-core.node')
copyFileSync(src, dest)
prepareMacArtifact(dest, 'forbidden')
console.log('[build-native] ✅', dest)

for (const baseName of ['sam-segmentation-worker', 'semantic-segmentation-worker', 'specialized-segmentation-worker', 'luna-inpaint-worker']) {
  const workerName = isWin ? `${baseName}.exe` : baseName
  const workerSrc = join(target ? join(rcDir, 'target', target, 'release') : join(rcDir, 'target', 'release'), workerName)
  const workerDest = join(rcDir, workerName)
  copyFileSync(workerSrc, workerDest)
  if (!isWin) chmodSync(workerDest, 0o755)
  prepareMacArtifact(workerDest, isMacX64 ? 'required' : 'optional')
  console.log('[build-native] ✅', workerDest)
}
