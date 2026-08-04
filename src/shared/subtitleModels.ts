const MODELSCOPE = 'https://www.modelscope.cn/models'
const PARAFORMER_REVISION = '6231c426de8033aa6e5aeceaea63b4645afce449'
const FSMN_VAD_REVISION = 'f04fc3013641c8d59c156e2cbf171c1ad596f74d'

export const SUBTITLE_ASR_MODEL = {
  id: 'paraformer-zh-q8',
  fileName: 'paraformer-q8.gguf',
  sizeBytes: 236_929_024,
  sha256: '42bf76ea1575a336aaca4c1b7c01a82b79113e6d04d0d6b799561bfcf07ee011',
  url: `${MODELSCOPE}/FunAudioLLM/Paraformer-GGUF/resolve/${PARAFORMER_REVISION}/paraformer-q8.gguf`,
  version: `paraformer-gguf-${PARAFORMER_REVISION.slice(0, 8)}-q8`,
  license: 'Apache-2.0',
  licenseUrl: 'https://www.modelscope.cn/models/FunAudioLLM/Paraformer-GGUF',
  source: 'https://www.modelscope.cn/models/FunAudioLLM/Paraformer-GGUF',
} as const

export const SUBTITLE_VAD_MODEL = {
  id: 'fsmn-vad-gguf',
  fileName: 'fsmn-vad.gguf',
  sizeBytes: 1_720_512,
  sha256: '1270f2559c495f4e7b6e739541151027d360761a3fda43fc147034f5719f5479',
  url: `${MODELSCOPE}/FunAudioLLM/fsmn-vad-GGUF/resolve/${FSMN_VAD_REVISION}/fsmn-vad.gguf`,
  version: `fsmn-vad-gguf-${FSMN_VAD_REVISION.slice(0, 8)}`,
  license: 'Apache-2.0',
  licenseUrl: 'https://www.modelscope.cn/models/FunAudioLLM/fsmn-vad-GGUF',
  source: 'https://www.modelscope.cn/models/FunAudioLLM/fsmn-vad-GGUF',
} as const
