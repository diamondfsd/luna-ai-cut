export type RuntimeResourceKind = 'font' | 'lut' | 'sidecar' | 'model'

export interface RuntimeResourceDefinition {
  id: string
  kind: RuntimeResourceKind
  version: string
  fileName: string
  url: string
  archiveBytes: number
  unpackedBytes: number
  sha256: string
  archiveRoot: string
  expectedFileCount: number
  archiveFormat: 'zip' | '7z'
  allowedExtensions: readonly string[] | null
  executablePaths?: readonly string[]
}

const RELEASE_BASE = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/runtime-resources-v1.0.0'
const BIREFNET_MPS_RELEASE_BASE = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/birefnet-mps-resources-v1.0.0'

export const RUNTIME_RESOURCE_DEFINITIONS = {
  fonts: {
    id: 'source-han-sans-sc',
    kind: 'font',
    version: '1.0.0',
    fileName: 'luna-runtime-fonts-v1.0.0.zip',
    url: `${RELEASE_BASE}/luna-runtime-fonts-v1.0.0.zip`,
    archiveBytes: 95_467_923,
    unpackedBytes: 115_533_216,
    sha256: '99a184a1bfc60968b9d7382e5904391b9c97b5b06901a4a8cb10746e27725f89',
    archiveRoot: 'fonts',
    expectedFileCount: 7,
    archiveFormat: 'zip',
    allowedExtensions: ['.otf'],
  },
  luts: {
    id: 'builtin-luts',
    kind: 'lut',
    version: '1.0.0',
    fileName: 'luna-runtime-luts-v1.0.0.zip',
    url: `${RELEASE_BASE}/luna-runtime-luts-v1.0.0.zip`,
    archiveBytes: 18_475_683,
    unpackedBytes: 57_222_151,
    sha256: '0842beb10d19f26132d8f6568228275862f2660f4dcb9a2b5d30055a15b2371f',
    archiveRoot: 'luts',
    expectedFileCount: 71,
    archiveFormat: 'zip',
    allowedExtensions: ['.cube', '.json'],
  },
  birefnetMpsRuntime: {
    id: 'birefnet-mps-runtime-macos-arm64',
    kind: 'sidecar',
    version: '1.0.0',
    fileName: 'luna-birefnet-mps-runtime-macos-arm64-v1.0.0.7z',
    url: `${BIREFNET_MPS_RELEASE_BASE}/luna-birefnet-mps-runtime-macos-arm64-v1.0.0.7z`,
    archiveBytes: 87_403_275,
    unpackedBytes: 626_185_325,
    sha256: 'f2abb46e43bf45cb28a51af49020c31b19029c75d0ff318b0f98fca3b1bad817',
    archiveRoot: 'birefnet-mps-runtime',
    expectedFileCount: 23_248,
    archiveFormat: '7z',
    allowedExtensions: null,
    executablePaths: [
      'birefnet-mps-runtime/birefnet-mps-worker',
      'birefnet-mps-runtime/python/Python.framework/Versions/3.12/bin/python3.12',
    ],
  },
  birefnetMpsModel: {
    id: 'birefnet-mps-model-lite',
    kind: 'model',
    version: '1.0.0',
    fileName: 'luna-birefnet-mps-model-lite-v1.0.0.7z',
    url: `${BIREFNET_MPS_RELEASE_BASE}/luna-birefnet-mps-model-lite-v1.0.0.7z`,
    archiveBytes: 161_073_452,
    unpackedBytes: 177_727_234,
    sha256: 'd880691db71d62b0aad84ef1e833d47833d5a348e28e963f3d3c2c8af20d2ec3',
    archiveRoot: 'birefnet-mps-model',
    expectedFileCount: 4,
    archiveFormat: '7z',
    allowedExtensions: ['.json', '.py', '.safetensors'],
  },
} as const satisfies Record<string, RuntimeResourceDefinition>

export type RuntimeResourceId = typeof RUNTIME_RESOURCE_DEFINITIONS[keyof typeof RUNTIME_RESOURCE_DEFINITIONS]['id']

export function getRuntimeResourceDefinition(id: RuntimeResourceId): RuntimeResourceDefinition {
  const definition = Object.values(RUNTIME_RESOURCE_DEFINITIONS).find((candidate) => candidate.id === id)
  if (!definition) throw new Error(`未知运行时资源: ${id}`)
  return definition
}
