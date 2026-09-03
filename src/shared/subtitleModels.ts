const MODELSCOPE = 'https://www.modelscope.cn/models'
const PARAFORMER_REVISION = '95cf6ebc2800a761d97cbb9142a3536d47dec8c7'
const PARAFORMER_MODEL_SHA256 = '3ef6c19369b912f7caf3cef8e545c5ccd1a33d9d7ec792a46668dc41c4b229ec'
const PARAFORMER_TOKENS_SHA256 = '4b2d964e18b9cf139b473003b6698fb2ed9a2a5ec55b93daa677b28f578897aa'
const SILERO_VAD_REVISION = 'e638eca036c3722da77f53a5f032500f1d033a34'
const SILERO_VAD_SHA256 = '2623a2953f6ff3d2c1e61740c6cdb7168133479b267dfef114a4a3cc5bdd788f'

export const SUBTITLE_ASR_MODEL = {
  id: 'paraformer-zh-small-onnx-int8',
  fileName: 'paraformer-zh-small-int8.onnx',
  sizeBytes: 81_828_675,
  sha256: PARAFORMER_MODEL_SHA256,
  url: `${MODELSCOPE}/pengzhendong/sherpa-onnx-paraformer-zh-small/resolve/${PARAFORMER_REVISION}/model.int8.onnx`,
  version: `sherpa-onnx-paraformer-zh-small-${PARAFORMER_REVISION.slice(0, 8)}-int8`,
  license: 'Apache-2.0',
  licenseUrl: 'https://www.modelscope.cn/models/pengzhendong/sherpa-onnx-paraformer-zh-small',
  source: 'https://www.modelscope.cn/models/pengzhendong/sherpa-onnx-paraformer-zh-small',
} as const

export const SUBTITLE_ASR_TOKENS_MODEL = {
  id: 'paraformer-zh-small-onnx-tokens',
  fileName: 'paraformer-zh-small-tokens.txt',
  sizeBytes: 75_352,
  sha256: PARAFORMER_TOKENS_SHA256,
  url: `${MODELSCOPE}/pengzhendong/sherpa-onnx-paraformer-zh-small/resolve/${PARAFORMER_REVISION}/tokens.txt`,
  version: `sherpa-onnx-paraformer-zh-small-${PARAFORMER_REVISION.slice(0, 8)}-tokens`,
  license: 'Apache-2.0',
  licenseUrl: 'https://www.modelscope.cn/models/pengzhendong/sherpa-onnx-paraformer-zh-small',
  source: 'https://www.modelscope.cn/models/pengzhendong/sherpa-onnx-paraformer-zh-small',
} as const

export const SUBTITLE_VAD_MODEL = {
  id: 'silero-vad-v5-onnx',
  fileName: 'silero_vad.onnx',
  sizeBytes: 2_327_524,
  sha256: SILERO_VAD_SHA256,
  url: `${MODELSCOPE}/pengzhendong/silero-vad/resolve/${SILERO_VAD_REVISION}/silero_vad.onnx`,
  version: `silero-vad-v5-${SILERO_VAD_REVISION.slice(0, 8)}`,
  license: 'Apache-2.0',
  licenseUrl: 'https://www.modelscope.cn/models/pengzhendong/silero-vad',
  source: 'https://www.modelscope.cn/models/pengzhendong/silero-vad',
} as const

const PUNCTUATION_REVISION = '8177426a1240345bd35b21616475ddcf425d5288'

export const SUBTITLE_PUNCTUATION_MODEL = {
  id: 'ct-transformer-punc-int8',
  fileName: 'model.int8.onnx',
  sizeBytes: 75_519_198,
  sha256: '65a3fb9f5ad7bfb96bf69e0dc4481df97f6ee60513c1d94ce981ba6effd524b1',
  url: `${MODELSCOPE}/ranger810/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8/resolve/${PUNCTUATION_REVISION}/model.int8.onnx`,
  version: `sherpa-onnx-${PUNCTUATION_REVISION.slice(0, 8)}-int8`,
  license: 'Apache-2.0',
  licenseUrl: 'https://www.modelscope.cn/models/iic/punc_ct-transformer_zh-cn-common-vocab272727-pytorch',
  source: 'https://www.modelscope.cn/models/ranger810/sherpa-onnx-punct-ct-transformer-zh-en-vocab272727-2024-04-12-int8',
} as const
