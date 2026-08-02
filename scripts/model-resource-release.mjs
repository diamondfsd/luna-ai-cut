import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { copyFile, mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import path from 'node:path'
import process from 'node:process'
import { pipeline } from 'node:stream/promises'
import { createRequire } from 'node:module'
import ts from 'typescript'

export const MODEL_RELEASE_VERSION = '1.0.0'
export const MODEL_RELEASE_TAG = `model-resources-v${MODEL_RELEASE_VERSION}`
export const MODEL_MANIFEST_NAME = `${MODEL_RELEASE_TAG}-r3.json`
export const SUBTITLE_MODEL_MANIFEST_NAME = `subtitle-${MODEL_RELEASE_TAG}.json`
export const DEFAULT_GITCODE_OWNER = 'diamondfsd'
export const DEFAULT_GITCODE_REPO = 'luna-ai-cut-package-release'

const require = createRequire(import.meta.url)

export async function loadModelRegistry(rootDir = process.cwd()) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), 'luna-model-registry-'))
  try {
    const sourceRoot = path.join(rootDir, 'src', 'shared')
    const sources = [
      path.join(sourceRoot, 'segmentationModels.ts'),
      path.join(sourceRoot, 'ade20kSegmentationTargets.ts'),
      path.join(sourceRoot, 'inpaintModels.ts'),
      path.join(sourceRoot, 'subtitleModels.ts'),
    ]
    const program = ts.createProgram(sources, {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      moduleResolution: ts.ModuleResolutionKind.Node10,
      rootDir,
      outDir: temporaryRoot,
      esModuleInterop: true,
      skipLibCheck: true,
    })
    const diagnostics = ts.getPreEmitDiagnostics(program)
    if (diagnostics.length > 0) {
      throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: (fileName) => fileName,
        getCurrentDirectory: () => rootDir,
        getNewLine: () => '\n',
      }))
    }
    if (program.emit().emitSkipped) throw new Error('模型注册表编译失败')
    await writeFile(path.join(temporaryRoot, 'package.json'), '{"type":"commonjs"}\n')
    return {
      ...require(path.join(temporaryRoot, 'src', 'shared', 'segmentationModels.js')),
      ...require(path.join(temporaryRoot, 'src', 'shared', 'inpaintModels.js')),
      ...require(path.join(temporaryRoot, 'src', 'shared', 'subtitleModels.js')),
    }
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true })
  }
}

function nonGitCodeSources(file) {
  return [...new Set([file.url, ...(file.mirrors ?? []), file.upstreamUrl].filter(Boolean))].filter((url) => !url.includes('gitcode.com/'))
}

function addArtifact(artifacts, artifact) {
  const existing = artifacts.find((candidate) => candidate.sha256 === artifact.sha256)
  if (existing) {
    existing.models.push(...artifact.models)
    existing.sourceUrls = [...new Set([...existing.sourceUrls, ...artifact.sourceUrls])]
    return
  }
  artifacts.push(artifact)
}

export function buildModelArtifacts(registry) {
  const artifacts = []
  for (const model of [...registry.SEGMENTATION_MODELS, ...registry.SPECIALIZED_SEGMENTATION_MODELS, ...registry.AI_SELECTION_MODELS, ...registry.INPAINT_MODELS]) {
    addArtifact(artifacts, {
      fileName: `${model.id}.onnx`,
      sizeBytes: model.sizeBytes,
      sha256: model.sha256,
      sourceUrls: nonGitCodeSources(model),
      models: [{ modelId: model.id, role: 'model', cacheFileName: model.fileName ?? 'model.onnx' }],
      version: model.version,
      license: model.license,
      source: model.source,
      licenseUrl: model.licenseUrl,
      trainingData: model.trainingData,
      trainingDataUrl: model.trainingDataUrl,
      convertedFromSha256: model.convertedFromSha256,
    })
  }
  for (const model of registry.SAM_MODELS) {
    for (const [role, file] of Object.entries(model.files)) {
      addArtifact(artifacts, {
        fileName: role === 'promptDecoder' ? 'sam-prompt-decoder-quantized.onnx' : `${model.id}-vision-encoder.onnx`,
        sizeBytes: file.sizeBytes,
        sha256: file.sha256,
        sourceUrls: nonGitCodeSources(file),
        models: [{ modelId: model.id, role }],
        version: model.version,
        license: model.license,
        source: model.source,
        licenseUrl: model.licenseUrl,
      })
    }
  }
  for (const model of [registry.SUBTITLE_ASR_MODEL, registry.SUBTITLE_VAD_MODEL]) {
    addArtifact(artifacts, {
      fileName: model.fileName,
      sizeBytes: model.sizeBytes,
      sha256: model.sha256,
      sourceUrls: nonGitCodeSources(model),
      models: [{ modelId: model.id, role: 'model', cacheFileName: model.fileName }],
      version: model.version,
      license: model.license,
      source: model.source,
      licenseUrl: model.licenseUrl,
    })
  }
  for (const artifact of artifacts) {
    if (artifact.sourceUrls.length === 0) throw new Error(`${artifact.fileName} 缺少非 GitCode 源地址`)
  }
  return artifacts.sort((left, right) => left.fileName.localeCompare(right.fileName, 'en'))
}

export function defaultModelCacheRoots() {
  const roots = []
  if (process.env.LUNA_MODEL_CACHE_DIR) roots.push(process.env.LUNA_MODEL_CACHE_DIR)
  if (process.platform === 'darwin') roots.push(path.join(homedir(), 'Library', 'Application Support', 'luna-ai-cut', 'models'))
  else if (process.platform === 'win32' && process.env.APPDATA) roots.push(path.join(process.env.APPDATA, 'luna-ai-cut', 'models'))
  else roots.push(path.join(process.env.XDG_CONFIG_HOME ?? path.join(homedir(), '.config'), 'luna-ai-cut', 'models'))
  return [...new Set(roots)]
}

function cachedFileName(reference) {
  if (reference.cacheFileName) return reference.cacheFileName
  if (reference.role === 'visionEncoder') return 'vision_encoder_quantized.onnx'
  if (reference.role === 'promptDecoder') return 'prompt_encoder_mask_decoder_quantized.onnx'
  return 'model.onnx'
}

async function fileHash(filePath) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(filePath)) hash.update(chunk)
  return hash.digest('hex')
}

async function validFile(filePath, artifact) {
  const info = await stat(filePath).catch(() => null)
  return Boolean(info?.isFile() && info.size === artifact.sizeBytes && await fileHash(filePath) === artifact.sha256)
}

export async function importCachedModelArtifacts(artifacts, outputDir, cacheRoots = defaultModelCacheRoots(), onProgress) {
  await mkdir(outputDir, { recursive: true })
  for (const artifact of artifacts) {
    const destination = path.join(outputDir, artifact.fileName)
    if (await validFile(destination, artifact)) {
      artifact.path = destination
      continue
    }
    for (const root of cacheRoots) {
      let imported = false
      for (const reference of artifact.models) {
        const cachedPath = path.join(root, reference.modelId, cachedFileName(reference))
        if (!await validFile(cachedPath, artifact)) continue
        const temporary = `${destination}.${process.pid}.import`
        await copyFile(cachedPath, temporary)
        if (!await validFile(temporary, artifact)) {
          await rm(temporary, { force: true })
          continue
        }
        await rename(temporary, destination)
        artifact.path = destination
        onProgress?.({ artifact, cachedPath })
        imported = true
        break
      }
      if (imported) break
    }
  }
  return artifacts
}

async function downloadFromSource(sourceUrl, temporaryPath, artifact, onProgress) {
  const partial = await stat(temporaryPath).catch(() => null)
  let offset = partial?.isFile() ? partial.size : 0
  if (offset > artifact.sizeBytes) {
    await rm(temporaryPath, { force: true })
    offset = 0
  }
  const response = await fetch(sourceUrl, {
    redirect: 'follow',
    headers: offset > 0 ? { Range: `bytes=${offset}-` } : undefined,
  })
  if (!response.ok || !response.body) throw new Error(`HTTP ${response.status}`)
  const append = offset > 0 && response.status === 206
  if (!append) offset = 0
  let completed = offset
  const progress = new TransformStream({
    transform(chunk, controller) {
      completed += chunk.byteLength
      if (completed > artifact.sizeBytes) throw new Error('下载大小超过登记值')
      onProgress?.(completed, artifact.sizeBytes)
      controller.enqueue(chunk)
    },
  })
  await pipeline(response.body.pipeThrough(progress), createWriteStream(temporaryPath, { flags: append ? 'a' : 'w', mode: 0o600 }))
}

export async function downloadModelArtifacts(artifacts, outputDir, onProgress) {
  await mkdir(outputDir, { recursive: true })
  for (const artifact of artifacts) {
    const destination = path.join(outputDir, artifact.fileName)
    if (await validFile(destination, artifact)) {
      onProgress?.({ phase: 'cached', artifact, completedBytes: artifact.sizeBytes, totalBytes: artifact.sizeBytes })
      artifact.path = destination
      continue
    }
    const temporary = `${destination}.${artifact.sha256.slice(0, 16)}.download`
    let lastError
    for (const sourceUrl of artifact.sourceUrls) {
      try {
        await downloadFromSource(sourceUrl, temporary, artifact, (completedBytes, totalBytes) => {
          onProgress?.({ phase: 'download', artifact, sourceUrl, completedBytes, totalBytes })
        })
        if (!await validFile(temporary, artifact)) throw new Error('大小或 SHA256 与登记值不一致')
        await rename(temporary, destination)
        artifact.path = destination
        lastError = null
        break
      } catch (error) {
        lastError = error
      }
    }
    if (lastError) throw new Error(`${artifact.fileName} 从登记源下载失败: ${lastError instanceof Error ? lastError.message : String(lastError)}`)
  }
  return artifacts
}

export async function writeModelManifest(artifacts, outputDir, owner = DEFAULT_GITCODE_OWNER, repo = DEFAULT_GITCODE_REPO, manifestName = MODEL_MANIFEST_NAME) {
  const downloadBase = `https://gitcode.com/${owner}/${repo}/releases/download/${MODEL_RELEASE_TAG}`
  const manifest = {
    schemaVersion: 1,
    releaseTag: MODEL_RELEASE_TAG,
    releaseVersion: MODEL_RELEASE_VERSION,
    repository: `${owner}/${repo}`,
    artifacts: artifacts.map((artifact) => {
      const manifestArtifact = { ...artifact }
      delete manifestArtifact.path
      return {
        ...manifestArtifact,
        url: `${downloadBase}/${encodeURIComponent(artifact.fileName)}`,
      }
    }),
  }
  const manifestPath = path.join(outputDir, manifestName)
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
  return { manifest, manifestPath }
}

async function gitCodeRequest(url, options, label) {
  const response = await fetch(url, options)
  if (!response.ok) throw new Error(`${label}失败: HTTP ${response.status} ${(await response.text()).slice(0, 300)}`)
  return response
}

async function getRelease(api, token) {
  const response = await fetch(`${api}/releases/tags/${MODEL_RELEASE_TAG}`, { headers: { 'PRIVATE-TOKEN': token } })
  if (response.status === 404) return null
  if (!response.ok) throw new Error(`查询 GitCode Release 失败: HTTP ${response.status}`)
  return response.json()
}

async function ensureRelease(api, token) {
  const existing = await getRelease(api, token)
  if (existing) return existing
  await gitCodeRequest(`${api}/releases`, {
    method: 'POST',
    headers: { 'PRIVATE-TOKEN': token, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      tag_name: MODEL_RELEASE_TAG,
      name: `Luna AI Cut Model Resources v${MODEL_RELEASE_VERSION}`,
      body: 'Luna AI Cut 按需下载的模型镜像。附件由登记源下载，并经过固定大小与 SHA256 校验。',
    }),
  }, '创建模型 Release')
  return getRelease(api, token)
}

function releaseAssets(release) {
  return Array.isArray(release?.assets) ? release.assets : []
}

async function uploadAsset(api, token, filePath) {
  const fileName = path.basename(filePath)
  const response = await gitCodeRequest(
    `${api}/releases/${MODEL_RELEASE_TAG}/upload_url?file_name=${encodeURIComponent(fileName)}`,
    { headers: { 'PRIVATE-TOKEN': token } },
    `获取 ${fileName} 上传地址`,
  )
  const payload = await response.json()
  if (!payload.url) throw new Error(`获取 ${fileName} 上传地址失败`)
  await gitCodeRequest(payload.url, {
    method: 'PUT',
    headers: payload.headers ?? {},
    body: await readFile(filePath),
  }, `上传 ${fileName}`)
}

async function verifyDownload(url, expected) {
  const response = await gitCodeRequest(url, {}, `回读 ${expected.fileName}`)
  const hash = createHash('sha256')
  let bytes = 0
  for await (const chunk of response.body) {
    bytes += chunk.byteLength
    hash.update(chunk)
  }
  const sha256 = hash.digest('hex')
  if (bytes !== expected.sizeBytes || sha256 !== expected.sha256) throw new Error(`${expected.fileName} 远端大小或 SHA256 不一致`)
  return { bytes, sha256 }
}

export async function publishModelRelease({ artifacts, manifestPath, token, owner = DEFAULT_GITCODE_OWNER, repo = DEFAULT_GITCODE_REPO, onProgress }) {
  if (!token) throw new Error('上传需要 GITCODE_TOKEN')
  const api = `https://api.gitcode.com/api/v5/repos/${owner}/${repo}`
  let release = await ensureRelease(api, token)
  const manifestInfo = await stat(manifestPath)
  const uploads = [
    ...artifacts.map((artifact) => ({ fileName: artifact.fileName, path: artifact.path, sizeBytes: artifact.sizeBytes, sha256: artifact.sha256 })),
    { fileName: path.basename(manifestPath), path: manifestPath, sizeBytes: manifestInfo.size, sha256: await fileHash(manifestPath) },
  ]
  for (const upload of uploads) {
    if (!releaseAssets(release).some((asset) => asset.name === upload.fileName)) {
      onProgress?.({ phase: 'upload', upload })
      await uploadAsset(api, token, upload.path)
      release = await getRelease(api, token)
    }
  }
  const downloadBase = `https://gitcode.com/${owner}/${repo}/releases/download/${MODEL_RELEASE_TAG}`
  const verified = []
  for (const upload of uploads) {
    if (!releaseAssets(release).some((asset) => asset.name === upload.fileName)) throw new Error(`GitCode Release 缺少附件: ${upload.fileName}`)
    onProgress?.({ phase: 'verify', upload })
    const url = `${downloadBase}/${encodeURIComponent(upload.fileName)}`
    verified.push({ fileName: upload.fileName, url, ...await verifyDownload(url, upload) })
  }
  return { releaseUrl: `https://gitcode.com/${owner}/${repo}/releases/tag/${MODEL_RELEASE_TAG}`, verified }
}
