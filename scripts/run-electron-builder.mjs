import { spawnSync } from 'node:child_process'

const args = process.argv.slice(2)
const resourcesDirIndex = args.indexOf('--resources-dir')
if (resourcesDirIndex < 0 || !args[resourcesDirIndex + 1]) {
  throw new Error('缺少 --resources-dir 参数')
}

const resourcesDir = args[resourcesDirIndex + 1]
const builderArgs = args.filter((_, index) => index !== resourcesDirIndex && index !== resourcesDirIndex + 1)
const command = process.platform === 'win32' ? 'electron-builder.cmd' : 'electron-builder'

const result = spawnSync(command, builderArgs, {
  stdio: 'inherit',
  env: {
    ...process.env,
    LUNA_PACKAGE_RESOURCES_DIR: resourcesDir,
    ELECTRON_BUILDER_COMPRESSION_LEVEL: '7',
  },
  shell: process.platform === 'win32',
})

if (result.error) throw result.error
process.exit(result.status ?? 1)
