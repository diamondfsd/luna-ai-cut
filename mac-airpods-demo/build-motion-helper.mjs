import { copyFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = dirname(fileURLToPath(import.meta.url))
const outputDir = join(root, '.runtime')
const appDir = join(outputDir, 'HeadphoneMotion.app')
const contentsDir = join(appDir, 'Contents')
const output = join(contentsDir, 'MacOS/headphone-motion')
const source = join(root, 'HeadphoneMotion.swift')
const info = join(root, 'Info.plist')

if (process.platform !== 'darwin') {
  console.error('AirPods 运动 helper 只能在 macOS 上构建。')
  process.exit(1)
}

await mkdir(join(contentsDir, 'MacOS'), { recursive: true })
await copyFile(info, join(contentsDir, 'Info.plist'))
const result = spawnSync('swiftc', [
  '-O',
  '-framework', 'AppKit',
  '-framework', 'CoreMotion',
  '-framework', 'Network',
  '-o', output,
  source,
], { stdio: 'inherit' })

if (result.status !== 0 || !existsSync(output)) {
  process.exit(result.status ?? 1)
}

console.log(`已构建 AirPods helper: ${output}`)
