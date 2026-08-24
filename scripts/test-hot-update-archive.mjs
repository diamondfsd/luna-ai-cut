import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import AdmZip from 'adm-zip'
import ts from 'typescript'

const projectRoot = path.resolve(import.meta.dirname, '..')
const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-hot-update-'))
const compiledRoot = path.join(temporaryRoot, 'compiled')

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}

function archiveBytes(files) {
  const zip = new AdmZip()
  for (const [filePath, content] of Object.entries(files)) {
    zip.addFile(filePath, Buffer.from(content))
  }
  return zip.toBuffer()
}

async function seedInstalledUpdate(hotDir) {
  await mkdir(path.join(hotDir, 'dist-electron'), { recursive: true })
  await mkdir(path.join(hotDir, 'dist'), { recursive: true })
  await writeFile(path.join(hotDir, 'dist-electron/luna-appMain.js'), 'old main')
  await writeFile(path.join(hotDir, 'dist-electron/preload.mjs'), 'old preload')
  await writeFile(path.join(hotDir, 'dist/index.html'), 'old page')
  await writeFile(path.join(hotDir, 'version.json'), JSON.stringify({ version: '1.7.0-hot.1' }))
}

try {
  const sourcePath = path.join(projectRoot, 'electron/infrastructure/hotUpdateArchiveService.ts')
  const program = ts.createProgram([sourcePath], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    rootDir: projectRoot,
    outDir: compiledRoot,
    skipLibCheck: true,
  })
  assert.deepEqual(ts.getPreEmitDiagnostics(program), [])
  assert.equal(program.emit().emitSkipped, false)
  await symlink(path.join(projectRoot, 'node_modules'), path.join(compiledRoot, 'node_modules'), 'dir')
  const { installHotUpdateArchive } = await import(pathToFileURL(path.join(compiledRoot, 'electron/infrastructure/hotUpdateArchiveService.js')))

  const validArchive = archiveBytes({
    'dist-electron/luna-appMain.js': 'new main',
    'dist-electron/preload.mjs': 'new preload',
    'dist/index.html': 'new page',
  })
  const hotDir = path.join(temporaryRoot, '.luna-hot')
  await seedInstalledUpdate(hotDir)

  let verifiedFetches = 0
  await installHotUpdateArchive(hotDir, {
    version: '1.7.0-hot.2',
    zipName: 'renderer-1.7.0-hot.2.zip',
    downloadUrl: 'https://fixture.invalid/renderer-1.7.0-hot.2.zip',
    integrity: { sha256: sha256(validArchive), sizeBytes: validArchive.byteLength },
  }, {
    fetcher: async () => {
      verifiedFetches += 1
      return verifiedFetches === 1
        ? new Response('temporarily unavailable', { status: 503 })
        : new Response(validArchive, { headers: { 'content-length': String(validArchive.byteLength) } })
    },
  })
  assert.equal(verifiedFetches, 2, '校验下载应在一次操作内重试')
  assert.equal(await readFile(path.join(hotDir, 'dist-electron/luna-appMain.js'), 'utf8'), 'new main')
  assert.equal(JSON.parse(await readFile(path.join(hotDir, 'version.json'), 'utf8')).version, '1.7.0-hot.2')
  assert.equal(existsSync(path.join(hotDir, '.install-staging')), false, '安装临时目录必须清理')

  const brokenHotDir = path.join(temporaryRoot, '.luna-hot-broken')
  await seedInstalledUpdate(brokenHotDir)
  const invalidArchive = Buffer.from('not a valid update archive')
  await assert.rejects(
    installHotUpdateArchive(brokenHotDir, {
      version: '1.7.0-hot.3',
      zipName: 'renderer-1.7.0-hot.3.zip',
      downloadUrl: 'https://fixture.invalid/renderer-1.7.0-hot.3.zip',
      integrity: { sha256: sha256(invalidArchive), sizeBytes: invalidArchive.byteLength },
    }, { fetcher: async () => new Response(invalidArchive) }),
    /更新包格式异常/,
  )
  assert.equal(await readFile(path.join(brokenHotDir, 'dist-electron/luna-appMain.js'), 'utf8'), 'old main')
  assert.equal(JSON.parse(await readFile(path.join(brokenHotDir, 'version.json'), 'utf8')).version, '1.7.0-hot.1')

  const legacyHotDir = path.join(temporaryRoot, '.luna-hot-legacy')
  let legacyFetches = 0
  await installHotUpdateArchive(legacyHotDir, {
    version: '1.7.0-hot.4',
    zipName: 'renderer-1.7.0-hot.4.zip',
    downloadUrl: 'https://fixture.invalid/renderer-1.7.0-hot.4.zip',
  }, {
    fetcher: async () => {
      legacyFetches += 1
      return legacyFetches === 1
        ? new Response('<html>temporary edge error</html>', { headers: { 'content-type': 'text/html' } })
        : new Response(validArchive, { headers: { 'content-length': String(validArchive.byteLength) } })
    },
  })
  assert.equal(legacyFetches, 2, '旧发布包也应在一次操作内重试')
  assert.equal(await readFile(path.join(legacyHotDir, 'dist/index.html'), 'utf8'), 'new page')
  console.log('hot update archive tests passed')
} finally {
  await rm(temporaryRoot, { recursive: true, force: true })
}
