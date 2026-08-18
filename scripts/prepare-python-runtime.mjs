import { createHash } from 'node:crypto'
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { path7za } from '7zip-bin'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = join(root, 'resources', 'python-runtime')
const PYTHON_VERSION = '3.12.14'
const PYTHON_BUILD = '20260814'
const RUNTIME_LAYOUT_VERSION = '2'
const PACKAGE_VERSIONS = {
  numpy: '2.5.2',
  onnxruntime: '1.29.0',
  sentencepiece: '0.2.2',
  'ai-edge-litert': '2.2.0',
  'backports.strenum': '1.2.8',
  flatbuffers: '25.12.19',
  ml_dtypes: '0.6.0',
  packaging: '26.3',
  protobuf: '7.35.1',
  tqdm: '4.70.0',
  'typing-extensions': '4.16.0',
}

const TARGETS = {
  'darwin-arm64': {
    platform: 'darwin',
    arch: 'arm64',
    triple: 'aarch64-apple-darwin',
    sha256: 'dd5b76ab11451a4a4367c17c61d944dded56b425396b07f102922a7ebef7d55f',
  },
  'darwin-x64': {
    platform: 'darwin',
    arch: 'x64',
    triple: 'x86_64-apple-darwin',
    sha256: 'aec265e3cddaccdb2a3d783331596351b24d4a63c97af0a38f75f643c9451de9',
  },
  'win32-x64': {
    platform: 'win32',
    arch: 'x64',
    triple: 'x86_64-pc-windows-msvc',
    sha256: '89f18f6932917163b74339ebcec2645c8e47ae7f1c5f2ac37f2b4f4cf3beb647',
  },
  'linux-arm64': {
    platform: 'linux',
    arch: 'arm64',
    triple: 'aarch64-unknown-linux-gnu',
    sha256: '2d8e17dfd732102cfeb18e0e1fa6769b24caa034e159981129590fe409c7157a',
  },
  'linux-x64': {
    platform: 'linux',
    arch: 'x64',
    triple: 'x86_64-unknown-linux-gnu',
    sha256: '5acfa3e9ba26b51ae161c83aff278da915b590d22373a424b2ba55b8afe91fcc',
  },
}

function valueAfterFlag(args, name, fallback) {
  const index = args.indexOf(name)
  return index >= 0 && args[index + 1] ? args[index + 1] : fallback
}

function targetConfig() {
  const args = process.argv.slice(2)
  const targetName = `${valueAfterFlag(args, '--target', process.platform)}-${valueAfterFlag(args, '--arch', process.arch === 'arm64' ? 'arm64' : 'x64')}`
  const target = TARGETS[targetName]
  if (!target) throw new Error(`不支持的 Python runtime 目标：${targetName}`)
  return { name: targetName, ...target }
}

function archiveName(target) {
  return `cpython-${PYTHON_VERSION}+${PYTHON_BUILD}-${target.triple}-install_only_stripped.tar.gz`
}

function archiveUrl(target) {
  return `https://github.com/astral-sh/python-build-standalone/releases/download/${PYTHON_BUILD}/${encodeURIComponent(archiveName(target))}`
}

function packageSpec() {
  return Object.entries(PACKAGE_VERSIONS).map(([name, version]) => `${name}==${version}`)
}

function runtimePythonCandidates(runtimeRoot, target) {
  if (target.platform === 'win32') {
    return [join(runtimeRoot, 'python.exe'), join(runtimeRoot, 'bin', 'python.exe')]
  }
  return [
    join(runtimeRoot, 'bin', `python${PYTHON_VERSION.split('.').slice(0, 2).join('.')}`),
    join(runtimeRoot, 'bin', `python${PYTHON_VERSION.split('.')[0]}`),
    join(runtimeRoot, 'bin', 'python3'),
    join(runtimeRoot, 'bin', 'python'),
  ]
}

async function firstExisting(paths) {
  for (const filePath of paths) {
    if (await access(filePath).then(() => true).catch(() => false)) return filePath
  }
  return null
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      stdio: options.inherit ? 'inherit' : ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })
    let stderr = ''
    if (!options.inherit) child.stderr?.on('data', (chunk) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code, signal) => {
      if (code === 0) resolveRun()
      else reject(new Error(stderr.trim() || `${command} exited with code ${code ?? signal ?? 'unknown'}`))
    })
  })
}

function buildEnvironment(temporary) {
  const home = join(temporary, 'home')
  return {
    ...process.env,
    HOME: home,
    USERPROFILE: home,
    TMPDIR: join(temporary, 'tmp'),
    TEMP: join(temporary, 'tmp'),
    TMP: join(temporary, 'tmp'),
    PIP_CACHE_DIR: join(temporary, 'pip-cache'),
    PYTHONNOUSERSITE: '1',
    PYTHONDONTWRITEBYTECODE: '1',
    PIP_DISABLE_PIP_VERSION_CHECK: '1',
    PIP_NO_CACHE_DIR: '1',
  }
}

function downloadProxy() {
  return process.env.LUNA_BUILD_PROXY
    ?? process.env.HTTPS_PROXY
    ?? process.env.https_proxy
    ?? process.env.ALL_PROXY
    ?? process.env.all_proxy
}

async function download(url, destination) {
  const curl = process.platform === 'win32' ? 'curl.exe' : 'curl'
  const args = ['--fail', '--location', '--retry', '3', '--retry-all-errors', '--connect-timeout', '30', '--max-time', '900']
  const proxy = downloadProxy()
  if (proxy) args.push('--proxy', proxy)
  args.push('--output', destination, url)
  await run(curl, args, { inherit: true })
}

async function sha256(filePath) {
  const hash = createHash('sha256')
  hash.update(await readFile(filePath))
  return hash.digest('hex')
}

async function extractArchive(archivePath, temporary) {
  const extracted = join(temporary, 'extracted')
  await mkdir(extracted, { recursive: true })
  await run(path7za, ['x', archivePath, `-o${extracted}`, '-y'], { inherit: true })
  const tarFile = (await readdir(extracted, { withFileTypes: true }))
    .find((entry) => entry.isFile() && entry.name.endsWith('.tar'))
  if (!tarFile) throw new Error('Python runtime 压缩包缺少 tar 文件。')
  await run(path7za, ['x', join(extracted, tarFile.name), `-o${extracted}`, '-y'], { inherit: true })
  const entries = await readdir(extracted, { withFileTypes: true })
  const pythonDirectory = entries.find((entry) => entry.isDirectory() && entry.name === 'python')
  if (!pythonDirectory) throw new Error('Python runtime 压缩包缺少 python 目录。')
  return join(extracted, pythonDirectory.name)
}

function shouldCopy(source, sourceRoot) {
  const pathFromRoot = relative(sourceRoot, source)
  return !pathFromRoot.split(/[\\/]/).includes('__pycache__') && !pathFromRoot.endsWith('.pyc')
}

async function runtimeMatches(target) {
  const manifestPath = join(output, 'manifest.json')
  const manifest = await readFile(manifestPath, 'utf8')
    .then((value) => JSON.parse(value))
    .catch(() => null)
  if (!manifest || manifest.layoutVersion !== RUNTIME_LAYOUT_VERSION || manifest.target !== target.name || manifest.pythonVersion !== PYTHON_VERSION) return false
  if (JSON.stringify(manifest.packages) !== JSON.stringify(PACKAGE_VERSIONS)) return false
  return Boolean(await firstExisting(runtimePythonCandidates(output, target)))
}

async function removeTestPayloads(runtimeRoot, target) {
  const sitePackages = target.platform === 'win32'
    ? join(runtimeRoot, 'Lib', 'site-packages')
    : join(runtimeRoot, 'lib', `python${PYTHON_VERSION.split('.').slice(0, 2).join('.')}`, 'site-packages')
  await rm(join(sitePackages, 'onnxruntime', 'datasets'), { recursive: true, force: true })
  await rm(join(runtimeRoot, 'bin', 'onnxruntime_test'), { force: true })
}

async function main() {
  const target = targetConfig()
  if (await runtimeMatches(target)) {
    console.log(`[python-runtime] already prepared for ${target.name}`)
    return
  }

  const temporary = await mkdtemp(join(tmpdir(), 'luna-python-runtime-'))
  const environment = buildEnvironment(temporary)
  await Promise.all([
    mkdir(environment.TMPDIR, { recursive: true }),
    mkdir(environment.HOME, { recursive: true }),
  ])
  const archivePath = join(temporary, archiveName(target))
  const url = archiveUrl(target)
  try {
    console.log(`[python-runtime] downloading ${url}`)
    await download(url, archivePath)
    const actualSha256 = await sha256(archivePath)
    if (actualSha256 !== target.sha256) {
      throw new Error(`Python runtime SHA256 校验失败：期望 ${target.sha256}，实际 ${actualSha256}`)
    }

    const sourceRoot = await extractArchive(archivePath, temporary)
    const pythonSource = await firstExisting(runtimePythonCandidates(sourceRoot, target))
    if (!pythonSource) throw new Error(`Python runtime 中找不到解释器：${target.name}`)

    await rm(output, { recursive: true, force: true })
    await mkdir(output, { recursive: true })
    await cp(sourceRoot, output, {
      recursive: true,
      filter: (source) => shouldCopy(source, sourceRoot),
    })

    const python = await firstExisting(runtimePythonCandidates(output, target))
    if (!python) throw new Error(`Python runtime 复制后找不到解释器：${target.name}`)
    if (target.platform !== 'win32') await chmod(python, 0o755)
    await run(python, ['-m', 'pip', '--version'], { cwd: root, env: environment })
    await run(python, ['-m', 'pip', 'install', '--no-input', '--no-compile', '--only-binary=:all:', '--disable-pip-version-check', ...packageSpec()], {
      cwd: root,
      env: environment,
      inherit: true,
    })
    await removeTestPayloads(output, target)
    await run(python, ['-c', 'import ai_edge_litert, numpy, onnxruntime, sentencepiece; print("python runtime dependencies ok")'], {
      cwd: root,
      env: environment,
      inherit: true,
    })
    await writeFile(join(output, 'manifest.json'), `${JSON.stringify({
      layoutVersion: RUNTIME_LAYOUT_VERSION,
      pythonVersion: PYTHON_VERSION,
      pythonBuild: PYTHON_BUILD,
      target: target.name,
      archive: archiveName(target),
      archiveSha256: target.sha256,
      archiveUrl: url,
      packages: PACKAGE_VERSIONS,
    }, null, 2)}\n`)
    console.log(`[python-runtime] prepared ${output}`)
  } finally {
    await rm(temporary, { recursive: true, force: true })
  }
}

await main()
