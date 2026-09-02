import { existsSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const executableName = `ffmpeg${process.platform === 'win32' ? '.exe' : ''}`
const appRoot = process.env.APP_ROOT ?? process.cwd()

function isFile(filePath) {
  try {
    return existsSync(filePath) && statSync(filePath).isFile()
  } catch {
    return false
  }
}

let packagePath = null
try {
  const exportedPath = require('ffmpeg-static')
  packagePath = typeof exportedPath === 'string'
    ? exportedPath
    : join(dirname(require.resolve('ffmpeg-static')), executableName)
} catch (error) {
  console.warn('[verify-ffmpeg] 无法读取 ffmpeg-static 依赖，将继续检查构建资源')
  console.warn(error instanceof Error ? error.message : String(error))
}

const candidates = [
  join(appRoot, 'resources', 'ffmpeg', executableName),
  packagePath,
].filter((candidate) => typeof candidate === 'string')
const available = candidates.find(isFile)

if (!available) {
  console.error(`[verify-ffmpeg] FFmpeg 二进制不存在，已检查: ${candidates.join(', ')}`)
  console.error('请检查 GitCode 构建依赖 Release，或执行: pnpm run copy-ffmpeg')
  process.exit(1)
}

console.log(`[verify-ffmpeg] OK: ${available}`)
