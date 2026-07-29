#!/usr/bin/env node
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import process from 'node:process'

const SOURCE_COMMIT = '22516991cbdf725e69b0b4a87e52ca16cce07c2d'
const SOURCE_URL = 'https://github.com/leejet/stable-diffusion.cpp.git'
const root = join(import.meta.dirname, '..')
const outputName = process.platform === 'win32' ? 'sd-cli.exe' : 'sd-cli'
const outputPath = join(root, 'luna-render-core', outputName)
const licensePath = join(root, 'luna-render-core', 'stable-diffusion.cpp-LICENSE.txt')
const targetIndex = process.argv.indexOf('--target')
const archIndex = process.argv.indexOf('--arch')
const targetPlatform = targetIndex >= 0 ? process.argv[targetIndex + 1] : process.platform
const targetArch = archIndex >= 0 ? process.argv[archIndex + 1] : process.arch
const supported = (targetPlatform === 'darwin' && targetArch === 'arm64') || (targetPlatform === 'win32' && targetArch === 'x64')

if (!supported) {
  rmSync(outputPath, { force: true })
  rmSync(licensePath, { force: true })
  console.log(`[generative-runtime] ${targetPlatform}/${targetArch} does not ship GPU reconstruction`)
  process.exit(0)
}
if (targetPlatform !== process.platform) {
  console.error(`[generative-runtime] ${targetPlatform} runtime must be built on that platform`)
  process.exit(1)
}

const cacheRoot = process.env.LUNA_SD_CPP_SOURCE_DIR
  ?? join(root, 'node_modules', '.cache', `stable-diffusion.cpp-${SOURCE_COMMIT.slice(0, 12)}`)
const run = (command, args, cwd = root) => {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' })
  if (result.error) {
    console.error(`[generative-runtime] failed to start ${command}: ${result.error.message}`)
    process.exit(1)
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
const bundledCmake = '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/native/build-tools/cmake/bin/cmake'
const cmake = process.env.CMAKE_BIN ?? (existsSync(bundledCmake) ? bundledCmake : 'cmake')

if (!existsSync(join(cacheRoot, 'CMakeLists.txt'))) {
  mkdirSync(join(root, 'node_modules', '.cache'), { recursive: true })
  run('git', ['clone', '--recursive', SOURCE_URL, cacheRoot])
  run('git', ['checkout', '--detach', SOURCE_COMMIT], cacheRoot)
  run('git', ['submodule', 'update', '--init', '--recursive'], cacheRoot)
}
const revision = spawnSync('git', ['rev-parse', 'HEAD'], { cwd: cacheRoot, encoding: 'utf8' })
if (revision.status !== 0 || revision.stdout.trim() !== SOURCE_COMMIT) {
  console.error(`[generative-runtime] source must be pinned to ${SOURCE_COMMIT}`)
  process.exit(1)
}

const buildDir = join(cacheRoot, targetPlatform === 'darwin' ? 'build-luna-metal-arm64' : 'build-luna-cuda-x64')
const configure = ['-S', cacheRoot, '-B', buildDir, '-DSD_BUILD_EXAMPLES=ON', '-DCMAKE_BUILD_TYPE=Release']
if (targetPlatform === 'darwin') configure.push('-DSD_METAL=ON', '-DSD_CUDA=OFF', '-DCMAKE_OSX_ARCHITECTURES=arm64')
else configure.push('-DSD_CUDA=ON', '-DSD_METAL=OFF')
run(cmake, configure)
run(cmake, ['--build', buildDir, '--config', 'Release', '--target', 'sd-cli', '--parallel'])

const candidates = [join(buildDir, 'bin', outputName), join(buildDir, 'bin', 'Release', outputName)]
const built = candidates.find(existsSync)
if (!built) {
  console.error('[generative-runtime] sd-cli build output was not found')
  process.exit(1)
}
copyFileSync(built, outputPath)
copyFileSync(join(cacheRoot, 'LICENSE'), licensePath)
if (targetPlatform === 'darwin') run('chmod', ['755', outputPath])
console.log(`[generative-runtime] ${outputPath}`)
