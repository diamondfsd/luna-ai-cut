const WHISPER_UPSTREAM = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/5359861c739e955e79d9a303bcbc70fb988958b1'
const VAD_UPSTREAM = 'https://huggingface.co/ggml-org/silero-v5.1.2/resolve/60cbe3094451f5bb86ecd0307c814356da24cdf6'
const MODEL_RELEASE = 'https://gitcode.com/diamondfsd/luna-ai-cut-package-release/releases/download/model-resources-v1.0.0'

export const SUBTITLE_ASR_MODEL = {
  id: 'whisper-small-q5-1',
  fileName: 'ggml-small-q5_1.bin',
  sizeBytes: 190_085_487,
  sha256: 'ae85e4a935d7a567bd102fe55afc16bb595bdb618e11b2fc7591bc08120411bb',
  url: `${MODEL_RELEASE}/ggml-small-q5_1.bin`,
  upstreamUrl: `${WHISPER_UPSTREAM}/ggml-small-q5_1.bin`,
  version: 'whisper.cpp-5359861-small-q5_1',
  license: 'MIT',
  source: 'https://huggingface.co/ggerganov/whisper.cpp',
} as const

export const SUBTITLE_VAD_MODEL = {
  id: 'silero-vad-v5-1-2',
  fileName: 'ggml-silero-v5.1.2.bin',
  sizeBytes: 885_098,
  sha256: '29940d98d42b91fbd05ce489f3ecf7c72f0a42f027e4875919a28fb4c04ea2cf',
  url: `${MODEL_RELEASE}/ggml-silero-v5.1.2.bin`,
  upstreamUrl: `${VAD_UPSTREAM}/ggml-silero-v5.1.2.bin`,
  version: 'silero-v5.1.2-60cbe30',
  license: 'MIT',
  source: 'https://huggingface.co/ggml-org/silero-v5.1.2',
} as const
