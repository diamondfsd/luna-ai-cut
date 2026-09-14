export const MUSICGEN_MODEL_ID = 'musicgen-small-onnx'
export const MUSICGEN_MODEL_VERSION = 'musicgen-small-onnx-675386ca'

const MODEL_RELEASE_BASE = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/model-resources-v1.0.0'
const UPSTREAM_MODEL_BASE = 'https://huggingface.co/gabotechs/music_gen/resolve/675386ca686a378fe9ff739b60fdf29c310b3560'

export const MUSICGEN_MODEL_FILES = [
  'config.json',
  'tokenizer.json',
  'text_encoder.onnx',
  'decoder_model_merged.onnx',
  'encodec_decode.onnx',
] as const

export type MusicGenModelFileName = typeof MUSICGEN_MODEL_FILES[number]

export interface MusicGenModelFileDefinition {
  fileName: MusicGenModelFileName
  sizeBytes: number
  sha256: string
  url: string
  upstreamUrl: string
}

// These are the exact small/fp32 files used by the MusicGPT ONNX pipeline.
// Runtime downloads go through the domestic release mirror; upstream URLs are retained for release auditing.
export const MUSICGEN_MODEL_FILE_DEFINITIONS = [
  {
    fileName: 'config.json',
    sizeBytes: 7_791,
    sha256: 'f290b5e3900a0f4db08eb6f2c09001f2bdbbc0c9bbc958340b8af40a3ae732bc',
    url: `${MODEL_RELEASE_BASE}/config.json`,
    upstreamUrl: `${UPSTREAM_MODEL_BASE}/small/config.json`,
  },
  {
    fileName: 'tokenizer.json',
    sizeBytes: 2_422_169,
    sha256: '71c33c3bf57bf2e19b4f8ac686ad8d182a79f7cd1a4921889437c453420223f1',
    url: `${MODEL_RELEASE_BASE}/tokenizer.json`,
    upstreamUrl: `${UPSTREAM_MODEL_BASE}/small/tokenizer.json`,
  },
  {
    fileName: 'text_encoder.onnx',
    sizeBytes: 438_689_759,
    sha256: '433fa8c0e3f60b7ff85c3eb48148c659b57504857c74d43190b2833f11ee3533',
    url: `${MODEL_RELEASE_BASE}/text_encoder.onnx`,
    upstreamUrl: `${UPSTREAM_MODEL_BASE}/small_fp32/text_encoder.onnx`,
  },
  {
    fileName: 'decoder_model_merged.onnx',
    sizeBytes: 1_692_230_645,
    sha256: 'e316822aa20ffe205dc675cd3a80ccaf332f283eb01a883d05199026ce2ad023',
    url: `${MODEL_RELEASE_BASE}/decoder_model_merged.onnx`,
    upstreamUrl: `${UPSTREAM_MODEL_BASE}/small_fp32/decoder_model_merged.onnx`,
  },
  {
    fileName: 'encodec_decode.onnx',
    sizeBytes: 118_056_304,
    sha256: 'ee905fd6a4b9094d499938b10cbc11fcf3935dddc7f723727457d21b25174ff0',
    url: `${MODEL_RELEASE_BASE}/encodec_decode.onnx`,
    upstreamUrl: `${UPSTREAM_MODEL_BASE}/small_fp32/encodec_decode.onnx`,
  },
] as const satisfies readonly MusicGenModelFileDefinition[]

export interface MusicGenModelManifestFile {
  fileName: MusicGenModelFileName
  sizeBytes: number
  sha256: string
}

export interface MusicGenModelManifest {
  schemaVersion: 1
  id: typeof MUSICGEN_MODEL_ID
  version: string
  files: MusicGenModelManifestFile[]
  license: string
  licenseUrl: string
  source: string
  upstreamModel: string
}

export const MUSICGEN_MODEL_INFO = {
  id: MUSICGEN_MODEL_ID,
  version: MUSICGEN_MODEL_VERSION,
  name: 'MusicGen Small（本地纯音乐）',
  description: '生成 1 到 30 秒的无歌词背景音乐片段',
  source: 'https://github.com/gabotechs/MusicGPT',
  upstreamModel: `${UPSTREAM_MODEL_BASE}/`,
  license: '代码 MIT；MusicGen 权重 CC BY-NC 4.0',
  licenseUrl: 'https://spdx.org/licenses/CC-BY-NC-4.0.html',
  files: MUSICGEN_MODEL_FILES,
} as const

export function isMusicGenModelManifest(value: unknown): value is MusicGenModelManifest {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const manifest = value as Partial<MusicGenModelManifest>
  if (
    manifest.schemaVersion !== 1
    || manifest.id !== MUSICGEN_MODEL_ID
    || manifest.version !== MUSICGEN_MODEL_INFO.version
    || manifest.license !== MUSICGEN_MODEL_INFO.license
    || manifest.licenseUrl !== MUSICGEN_MODEL_INFO.licenseUrl
    || manifest.source !== MUSICGEN_MODEL_INFO.source
    || manifest.upstreamModel !== MUSICGEN_MODEL_INFO.upstreamModel
    || !Array.isArray(manifest.files)
    || manifest.files.length !== MUSICGEN_MODEL_FILE_DEFINITIONS.length
  ) return false
  const expected = new Map(MUSICGEN_MODEL_FILE_DEFINITIONS.map((file) => [file.fileName, file]))
  const files = manifest.files as unknown as Array<Record<string, unknown>>
  if (files.some((file) => !file || typeof file !== 'object' || Array.isArray(file))) return false
  if (new Set(files.map((file) => file.fileName)).size !== expected.size) return false
  return files.every((file) => {
    const definition = expected.get(file.fileName as MusicGenModelFileName)
    return Boolean(
      definition
      && file.sizeBytes === definition.sizeBytes
      && typeof file.sha256 === 'string'
      && file.sha256.toLowerCase() === definition.sha256,
    )
  })
}
