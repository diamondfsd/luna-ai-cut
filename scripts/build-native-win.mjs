#!/usr/bin/env node

import { spawnSync } from 'node:child_process'

const windowsTarget = 'x86_64-pc-windows-msvc'
const environment = { ...process.env }

if (process.platform !== 'win32') {
  const xwin = spawnSync('cargo', ['xwin', '--version'], { stdio: 'pipe' })
  if (xwin.status !== 0) {
    console.error('[build-native-win] 非 Windows 主机构建需要 cargo-xwin，请先安装 cargo install cargo-xwin')
    process.exit(1)
  }
  environment.CROSS_TARGET = windowsTarget
  environment.CARGO_XWIN = '1'
  console.log(`[build-native-win] 使用交叉编译：${process.platform}-${process.arch} -> ${windowsTarget}`)
} else {
  console.log(`[build-native-win] 使用 Windows 原生编译：${process.platform}-${process.arch}`)
}

const result = spawnSync(process.execPath, ['scripts/build-native.mjs'], {
  env: environment,
  stdio: 'inherit',
})
process.exit(result.status ?? 1)
