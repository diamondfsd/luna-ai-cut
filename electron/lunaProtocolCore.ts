import { app } from 'electron'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
let cached: Record<string, unknown> | null = null

function protocolDirectory(): string {
  if (app.isPackaged) return join(process.resourcesPath, 'luna-protocol')
  return join(dirname(fileURLToPath(import.meta.url)), '..', 'vendor', 'luna-protocol')
}

export function loadLunaProtocolCore(): Record<string, unknown> {
  if (cached) return cached

  const directory = protocolDirectory()
  const modulePath = join(directory, 'luna-protocol.cjs')
  const checksumPath = join(directory, 'luna-protocol.sha256')
  if (!existsSync(modulePath) || !existsSync(checksumPath)) {
    throw new Error('当前构建缺少 Luna 相机连接组件，请使用官方安装包或重新生成协议产物')
  }

  const expected = readFileSync(checksumPath, 'utf8').trim().split(/\s+/)[0]
  const actual = createHash('sha256').update(readFileSync(modulePath)).digest('hex')
  if (!expected || actual !== expected) {
    throw new Error('Luna 相机连接组件校验失败，请重新安装应用')
  }

  cached = require(modulePath) as Record<string, unknown>
  return cached
}
