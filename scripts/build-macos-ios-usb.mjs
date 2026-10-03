// Rebuild standalone iPhone USB tools; never builds or packages the application.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chmodSync, copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import process from 'node:process'

const root = resolve(import.meta.dirname, '..')
const cache = join(root, '.cache', 'ios-usb-sources')
const sources = [
  ['openssl', '3.5.9', '45e844fa2a14ec92d146bd8f5778ac130b6625fb', 'https://github.com/openssl/openssl.git'],
  ['libplist', '2.7.0', 'cf5897a71ea412ea2aeb1e2f6b5ea74d4fabfd8c'],
  ['libimobiledevice-glue', '1.3.2', 'aef2bf0f5bfe961ad83d224166462d87b1df2b00'],
  ['libusbmuxd', '2.1.1', 'adf9c22b9010490e4b55eaeb14731991db1c172c'],
  ['libtatsu', '1.0.5', '42329cb756682535c7c0f087987b78d1dd5b16c8'],
  ['libimobiledevice', '1.4.0', '149f7623c672c1fa73122c7119a12bfc0012f2ac'],
].map(([name, version, commit, url]) => ({ name, version, commit, url: url ?? `https://github.com/libimobiledevice/${name}.git` }))
const tools = ['iproxy', 'idevice_id', 'idevicepair']
const index = process.argv.indexOf('--arch')
const architectures = index < 0 ? ['arm64', 'x64'] : [process.argv[index + 1]]
if (process.platform !== 'darwin') throw new Error('macOS USB 工具需要在 macOS 上编译')
if (architectures.some((arch) => !['arm64', 'x64'].includes(arch))) throw new Error('架构必须为 arm64 或 x64')

function run(command, args, cwd = root, env = process.env) {
  return execFileSync(command, args, { cwd, env: { ...env, PATH: '/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin' }, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 64 * 1024 * 1024 }).toString().trim()
}

mkdirSync(cache, { recursive: true })
for (const source of sources) {
  const directory = join(cache, source.name)
  if (!existsSync(directory)) {
    run('git', ['init', directory])
    run('git', ['remote', 'add', 'origin', source.url], directory)
    run('git', ['fetch', '--depth', '1', 'origin', source.commit], directory)
    run('git', ['checkout', '--detach', 'FETCH_HEAD'], directory)
  }
  if (run('git', ['rev-parse', 'HEAD'], directory) !== source.commit) throw new Error(`源代码版本不匹配：${source.name}`)
  if (run('git', ['status', '--porcelain', '--untracked-files=no'], directory)) throw new Error(`源代码已修改：${source.name}`)
  if (source.name !== 'openssl' && !existsSync(join(directory, 'configure'))) {
    run('sh', ['autogen.sh'], directory, { ...process.env, NOCONFIGURE: '1' })
  }
}

for (const arch of architectures) {
  const cpu = arch === 'x64' ? 'x86_64' : 'arm64'
  const work = join(cache, `build-${arch}`)
  const prefix = join(work, 'prefix')
  const output = join(root, 'resources', 'ios-usb', `darwin-${arch}`)
  const env = {
    ...process.env,
    MACOSX_DEPLOYMENT_TARGET: '12.0',
    CC: 'clang', CXX: 'clang++',
    CFLAGS: `-O2 -arch ${cpu} -mmacosx-version-min=12.0`,
    CXXFLAGS: `-O2 -arch ${cpu} -mmacosx-version-min=12.0`,
    LDFLAGS: `-arch ${cpu} -mmacosx-version-min=12.0`,
    PKG_CONFIG_PATH: '', PKG_CONFIG_LIBDIR: join(prefix, 'lib', 'pkgconfig'),
    // Use Apple's system curl, never the build host's Homebrew curl.
    libcurl_CFLAGS: '-I' + run('xcrun', ['--show-sdk-path']) + '/usr/include',
    libcurl_LIBS: '-lcurl',
  }
  for (const source of sources) {
    console.log(`[ios-usb-build] ${arch}: ${source.name} ${source.version}`)
    const build = join(work, source.name)
    mkdirSync(build, { recursive: true })
    const directory = join(cache, source.name)
    env.CPPFLAGS = `-I${build}`
    if (source.name !== 'openssl' || !existsSync(join(build, 'Makefile'))) {
      if (source.name === 'openssl') {
        run('perl', [join(directory, 'Configure'), cpu === 'arm64' ? 'darwin64-arm64-cc' : 'darwin64-x86_64-cc',
          `--prefix=${prefix}`, '--libdir=lib', 'shared', 'no-tests', 'no-module', 'no-zlib'], build, env)
      } else {
        const options = source.name === 'libplist' ? ['--without-cython', '--without-tests']
          : source.name === 'libimobiledevice' ? ['--without-cython', '--without-readline'] : []
        run(join(directory, 'configure'), [`--prefix=${prefix}`, `--host=${cpu}-apple-darwin`, '--disable-static', ...options], build, env)
      }
    }
    run('make', ['-j8'], build, env)
    run('make', [source.name === 'openssl' ? 'install_sw' : 'install'], build, env)
  }
  rmSync(output, { recursive: true, force: true })
  mkdirSync(output, { recursive: true })
  for (const tool of tools) copyFileSync(join(prefix, 'bin', tool), join(output, tool))
  // Walk the actual dependency closure, including dependencies of dependencies.
  const queue = [...tools]
  const copied = new Set(queue)
  for (const name of queue) {
    const file = join(output, name)
    chmodSync(file, 0o755)
    const dependencies = run('otool', ['-L', file]).split('\n').slice(1)
      .map((line) => line.trim().split(' (')[0])
    const changes = []
    for (const dependency of dependencies) {
      if (dependency.startsWith('/usr/lib/') || dependency.startsWith('/System/Library/')) continue
      if (!dependency.startsWith(prefix + '/')) throw new Error(`非独立依赖：${name}: ${dependency}`)
      const library = basename(dependency)
      changes.push('-change', dependency, `@loader_path/${library}`)
      if (!copied.has(library)) {
        copyFileSync(dependency, join(output, library))
        copied.add(library)
        queue.push(library)
      }
    }
    if (name.endsWith('.dylib')) changes.push('-id', `@loader_path/${name}`)
    if (changes.length) run('install_name_tool', [...changes, file])
    run('codesign', ['--force', '--sign', '-', file])
  }
  const licenses = join(output, 'licenses')
  for (const source of sources) {
    const directory = join(licenses, source.name)
    mkdirSync(directory, { recursive: true })
    for (const name of readdirSync(join(cache, source.name)).filter((name) => /^(COPYING(?:\.LESSER)?|LICENSE\.txt|NOTICE)$/.test(name))) {
      copyFileSync(join(cache, source.name, name), join(directory, name))
    }
    // Corresponding unmodified source accompanies the standalone LGPL/GPL tools.
    if (source.name !== 'openssl') run('git', ['archive', '--format=tar.gz', `--prefix=${source.name}-${source.version}/`,
      `--output=${join(directory, 'source.tar.gz')}`, source.commit], join(cache, source.name))
  }
  copyFileSync(join(root, 'resources', 'ios-usb', 'README.md'), join(output, 'README.md'))
  copyFileSync(join(root, 'scripts', 'build-macos-ios-usb.mjs'), join(licenses, 'build-macos-ios-usb.mjs'))
  const manifest = {
    platform: 'darwin', arch, minimumMacOS: '12.0', tools,
    licenseFiles: Object.fromEntries(readdirSync(licenses, { recursive: true }).filter((name) => !name.split('/').includes('.DS_Store') && statSync(join(licenses, name)).isFile()).map((name) => [name, createHash('sha256').update(readFileSync(join(licenses, name))).digest('hex')])),
    sources, buildScript: 'scripts/build-macos-ios-usb.mjs',
    files: Object.fromEntries([...copied].sort().map((name) => [name, {
      size: readFileSync(join(output, name)).length,
      sha256: createHash('sha256').update(readFileSync(join(output, name))).digest('hex'),
    }])),
  }
  writeFileSync(join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n')
  console.log(`[ios-usb-build] 完成: ${output}`)
}
