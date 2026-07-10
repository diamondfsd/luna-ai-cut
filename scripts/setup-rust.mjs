#!/usr/bin/env node
/**
 * 初始化 Rust 工具链，确保 cargo 可用并安装必要的交叉编译 target。
 *
 * 用法：
 *   node scripts/setup-rust.mjs                          # 仅确保当前平台工具链
 *   node scripts/setup-rust.mjs --target x86_64-apple-darwin  # 额外安装指定 target
 *
 * CI 中通过 CROSS_TARGET 环境变量指定：
 *   CROSS_TARGET=x86_64-apple-darwin node scripts/setup-rust.mjs
 */

import { spawnSync } from 'node:child_process'
import { platform } from 'node:os'

// ── 解析需要安装的 target ──
const cliTarget = process.argv.includes('--target')
  ? process.argv[process.argv.indexOf('--target') + 1]
  : null

const crossTarget = process.env.CROSS_TARGET || cliTarget

// ── 获取当前平台的默认 target ──
function defaultTarget() {
  switch (platform()) {
    case 'darwin': return 'aarch64-apple-darwin'
    case 'win32':  return 'x86_64-pc-windows-msvc'
    case 'linux':  return 'x86_64-unknown-linux-gnu'
    default:       return null
  }
}

// ── 1. 检查 rustup 是否可用 ──
const hasRustup = spawnSync('rustup', ['--version'], { stdio: 'pipe' }).status === 0
const hasCargo = spawnSync('cargo', ['--version'], { stdio: 'pipe' }).status === 0

if (!hasRustup && !hasCargo) {
  console.log('[setup-rust] ⚠️  rustup not found, installing via rustup.rs...')

  if (platform() === 'win32') {
    // Windows: 下载 rustup-init.exe
    const download = spawnSync('powershell', [
      '-Command',
      'Invoke-WebRequest -Uri https://win.rustup.rs/x86_64 -OutFile rustup-init.exe; ./rustup-init.exe -y --default-toolchain stable'
    ], { stdio: 'inherit' })
    if (download.status !== 0) {
      console.error('[setup-rust] ❌ Failed to install Rust on Windows')
      process.exit(1)
    }
  } else {
    // macOS / Linux: curl | sh
    const install = spawnSync('sh', ['-c', 'curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable'], { stdio: 'inherit' })
    if (install.status !== 0) {
      console.error('[setup-rust] ❌ Failed to install Rust')
      process.exit(1)
    }
  }

  // 更新 PATH，使后续命令能找到 rustup/cargo
  const { homedir } = await import('node:os')
  const cargoHome = process.env.CARGO_HOME || `${homedir()}/.cargo`
  process.env.PATH = `${cargoHome}/bin:${process.env.PATH}`
} else {
  console.log('[setup-rust] ✅ rustup/cargo already available')
}

// ── 2. 确保 stable 工具链已安装 ──
console.log('[setup-rust] Ensuring stable toolchain...')
const stable = spawnSync('rustup', ['toolchain', 'install', 'stable', '--no-self-update'], { stdio: 'inherit' })
// toolchain install 返回非 0 可能只是已安装，忽略

// ── 3. 收集需要安装的 target ──
const targetsToInstall = []
const defaultT = defaultTarget()
if (defaultT) targetsToInstall.push(defaultT)
if (crossTarget && crossTarget !== defaultT) targetsToInstall.push(crossTarget)

// ── 4. 查看已安装的 target ──
const installed = spawnSync('rustup', ['target', 'list', '--installed'], { stdio: 'pipe' })
const installedTargets = new Set(
  installed.stdout.toString().trim().split('\n').map(s => s.trim()).filter(Boolean)
)

// ── 5. 安装缺失的 target ──
for (const t of targetsToInstall) {
  if (installedTargets.has(t)) {
    console.log(`[setup-rust] ✅ target ${t} already installed`)
  } else {
    console.log(`[setup-rust] Installing target ${t}...`)
    const add = spawnSync('rustup', ['target', 'add', t], { stdio: 'inherit' })
    if (add.status !== 0) {
      console.error(`[setup-rust] ❌ Failed to add target ${t}`)
      process.exit(1)
    }
    console.log(`[setup-rust] ✅ target ${t} installed`)
  }
}

console.log('[setup-rust] 🎉 Rust toolchain ready')
