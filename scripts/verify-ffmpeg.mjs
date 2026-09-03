import { spawnSync } from 'node:child_process'
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

function checkExecutable(filePath) {
  if (!isFile(filePath)) return { ok: false, reason: 'file not found' }

  const result = spawnSync(filePath, ['-version'], {
    stdio: 'ignore',
    windowsHide: true,
    timeout: 15_000,
  })
  if (result.error) return { ok: false, reason: result.error.message }
  if (result.status !== 0) {
    return { ok: false, reason: `exit=${result.status ?? 'unknown'} signal=${result.signal ?? 'none'}` }
  }
  return { ok: true, reason: 'ok' }
}

let packagePath = null
try {
  const exportedPath = require('ffmpeg-static')
  packagePath = typeof exportedPath === 'string'
    ? exportedPath
    : join(dirname(require.resolve('ffmpeg-static')), executableName)
} catch (error) {
  console.warn('[verify-ffmpeg] Could not resolve ffmpeg-static; checking prepared resources only')
  console.warn(error instanceof Error ? error.message : String(error))
}

const candidates = [
  join(appRoot, 'resources', 'ffmpeg', executableName),
  packagePath,
].filter((candidate) => typeof candidate === 'string')
const checks = candidates.map((filePath) => ({ filePath, result: checkExecutable(filePath) }))
const available = checks.find(({ result }) => result.ok)?.filePath

if (!available) {
  const details = checks.map(({ filePath, result }) => `${filePath} (${result.reason})`).join(', ')
  console.error(`[verify-ffmpeg] FFmpeg is not executable: ${details}`)
  console.error('[verify-ffmpeg] Check the GitCode build-dependencies release or run: pnpm run copy-ffmpeg')
  process.exit(1)
}

console.log(`[verify-ffmpeg] OK: ${available}`)
