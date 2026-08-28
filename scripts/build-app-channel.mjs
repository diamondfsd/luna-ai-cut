#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

const channel = process.argv[2]
if (channel !== 'stable' && channel !== 'test') {
  throw new Error('用法: node scripts/build-app-channel.mjs <stable|test>')
}

const command = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm'
const env = { ...process.env, LUNA_BUILD_CHANNEL: channel }

for (const args of [['exec', 'tsc'], ['exec', 'vite', 'build']]) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env,
    // Windows cannot reliably spawn pnpm.cmd directly from Node 22 without a shell.
    shell: process.platform === 'win32',
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}
