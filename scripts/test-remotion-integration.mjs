import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { access, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const worker = path.join(root, 'electron', 'remotion-render-worker.mjs')
const browser = path.join(root, 'resources', 'remotion-browser', 'mac-arm64', 'chrome-headless-shell-mac-arm64', 'chrome-headless-shell')
const binaries = path.join(root, 'resources', 'remotion-binaries')
const sampleMedia = path.join(root, 'vendor', 'video-shotcraft', 'gallery', 'media', 'poster', 'paper-title-card.jpg')

async function exists(filePath) {
  return access(filePath).then(() => true).catch(() => false)
}

function scene(durationInFrames = 30, mediaId) {
  return {
    version: 1,
    composition: 'shotcraft-promo',
    width: 640,
    height: 360,
    fps: 30,
    durationInFrames,
    shots: [{
      id: 'intro',
      recipe: mediaId ? 'media-zoom' : 'title-card',
      from: 0,
      durationInFrames,
      mediaIds: mediaId ? [mediaId] : [],
      text: { title: 'FreeCut', detail: 'Self-contained Remotion render' },
    }],
  }
}

function runWorker(input, { cancelAfterMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [worker], {
      cwd: root,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8') })
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8') })
    const timer = cancelAfterMs === undefined ? undefined : setTimeout(() => child.kill('SIGTERM'), cancelAfterMs)
    child.once('error', reject)
    child.once('close', (code, signal) => {
      if (timer) clearTimeout(timer)
      resolve({ code, signal, stdout, stderr })
    })
    child.stdin.end(JSON.stringify(input))
  })
}

if (process.platform !== 'darwin' || process.arch !== 'arm64') {
  console.log(`Remotion integration smoke test skipped on ${process.platform}-${process.arch}; packaged target tests run on native builders.`)
  process.exit(0)
}

assert.equal(await exists(worker), true, 'Remotion worker is missing')
assert.equal(await exists(browser), true, 'prepared Headless Chrome is missing; run pnpm prepare:remotion-runtime')
assert.equal(await exists(path.join(binaries, 'remotion')), true, 'prepared compositor is missing; run pnpm prepare:remotion-runtime')

const tempRoot = await mkdtemp(path.join(os.tmpdir(), 'freecut-remotion-test-'))
try {
  const outputPath = path.join(tempRoot, 'render.mp4')
  const manifestPath = path.join(tempRoot, 'render-manifest.json')
  const bundleDirectory = path.join(tempRoot, 'bundle')
  const result = await runWorker({
    entryPoint: path.join(root, 'integrations', 'remotion', 'src', 'index.tsx'),
    rootDir: root,
    bundleDirectory,
    binariesDirectory: binaries,
    browserExecutable: browser,
    outputPath,
    manifestPath,
    scene: scene(30, 'sample-poster'),
    media: [{ id: 'sample-poster', name: 'paper-title-card.jpg', path: sampleMedia }],
  })
  assert.equal(result.code, 0, result.stderr || result.stdout)
  const output = await readFile(outputPath)
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
  assert.ok(output.byteLength > 1_000, 'rendered MP4 is unexpectedly small')
  assert.equal(manifest.remotionVersion, '4.0.484')
  assert.equal(manifest.output.bytes, output.byteLength)
  assert.equal(manifest.output.sha256, createHash('sha256').update(output).digest('hex'))
  assert.deepEqual(manifest.inputMediaIds, ['sample-poster'])

  const clipRoot = path.join(tempRoot, 'clip-source')
  await mkdir(path.join(clipRoot, 'src'), { recursive: true })
  await writeFile(path.join(clipRoot, 'src', 'Root.tsx'), `
    import { AbsoluteFill, Composition, Img } from 'remotion'
    function Scene({ media }) {
      return <AbsoluteFill style={{ backgroundColor: '#101418' }}>
        {media[0] ? <Img src={media[0].src} style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : null}
      </AbsoluteFill>
    }
    export default function Root() {
      return <Composition id="remotion-clip" component={Scene} width={640} height={360} fps={30} durationInFrames={30} defaultProps={{ media: [] }} />
    }
  `)
  await writeFile(path.join(clipRoot, 'entry.tsx'), `import { registerRoot } from 'remotion'\nimport Root from './src/Root'\nregisterRoot(Root)\n`)
  const clipOutputPath = path.join(tempRoot, 'clip-render.mp4')
  const clipManifestPath = path.join(tempRoot, 'clip-render-manifest.json')
  const clipResult = await runWorker({
    entryPoint: path.join(clipRoot, 'entry.tsx'),
    rootDir: root,
    bundleDirectory: path.join(tempRoot, 'clip-bundle'),
    binariesDirectory: binaries,
    browserExecutable: browser,
    outputPath: clipOutputPath,
    manifestPath: clipManifestPath,
    compositionId: 'remotion-clip',
    projectId: 'project-1',
    clipId: 'clip-1',
    sourceRevision: 2,
    sourceHash: 'source-hash',
    kind: 'render',
    media: [{ id: 'sample-poster', name: 'paper-title-card.jpg', path: sampleMedia }],
  })
  assert.equal(clipResult.code, 0, clipResult.stderr || clipResult.stdout)
  const clipManifest = JSON.parse(await readFile(clipManifestPath, 'utf8'))
  assert.equal(clipManifest.composition, 'remotion-clip')
  assert.equal(clipManifest.clipId, 'clip-1')
  assert.equal(clipManifest.sourceRevision, 2)
  assert.equal(clipManifest.sourceHash, 'source-hash')

  const cancelOutputPath = path.join(tempRoot, 'cancel.mp4')
  const cancelManifestPath = path.join(tempRoot, 'cancel-manifest.json')
  const canceled = await runWorker({
    entryPoint: path.join(root, 'integrations', 'remotion', 'src', 'index.tsx'),
    rootDir: root,
    bundleDirectory: path.join(tempRoot, 'cancel-bundle'),
    binariesDirectory: binaries,
    browserExecutable: browser,
    outputPath: cancelOutputPath,
    manifestPath: cancelManifestPath,
    scene: scene(300),
    media: [],
  }, { cancelAfterMs: 250 })
  assert.notEqual(canceled.code, 0, 'cancelled worker unexpectedly succeeded')
  assert.equal(await exists(cancelManifestPath), false, 'cancelled render wrote a manifest')

  const outputStats = await stat(outputPath)
  console.log(`Remotion integration passed: ${outputStats.size} bytes, sha256 ${manifest.output.sha256}`)
} finally {
  await rm(tempRoot, { recursive: true, force: true })
}
