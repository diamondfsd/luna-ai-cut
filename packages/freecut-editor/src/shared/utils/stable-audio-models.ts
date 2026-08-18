export const STABLE_AUDIO_MODEL_IDS = ['small-music', 'small-sfx'] as const

export type StableAudioModelId = (typeof STABLE_AUDIO_MODEL_IDS)[number]

export interface StableAudioModelDefinition {
  id: StableAudioModelId
  label: string
  description: string
  estimatedBytes: number
  defaultDurationSeconds: number
  minDurationSeconds: number
  maxDurationSeconds: number
}

export const DEFAULT_STABLE_AUDIO_MODEL: StableAudioModelId = 'small-music'

const SHARED_BYTES = 1_001_631_971
const DIT_BYTES = 1_838_758_544

const DEFINITIONS: Record<StableAudioModelId, StableAudioModelDefinition> = {
  'small-music': {
    id: 'small-music',
    label: '背景音乐',
    description: '适合旋律、氛围和配乐。',
    estimatedBytes: SHARED_BYTES + DIT_BYTES,
    defaultDurationSeconds: 8,
    minDurationSeconds: 2,
    maxDurationSeconds: 30,
  },
  'small-sfx': {
    id: 'small-sfx',
    label: '音效',
    description: '适合动作、环境和转场声音。',
    estimatedBytes: SHARED_BYTES + DIT_BYTES,
    defaultDurationSeconds: 4,
    minDurationSeconds: 2,
    maxDurationSeconds: 30,
  },
}

export const STABLE_AUDIO_MODEL_OPTIONS = STABLE_AUDIO_MODEL_IDS.map((id) => ({
  value: id,
  label: DEFINITIONS[id].label,
  description: DEFINITIONS[id].description,
  estimatedBytes: DEFINITIONS[id].estimatedBytes,
}))

export function getStableAudioModelDefinition(model: StableAudioModelId): StableAudioModelDefinition {
  return DEFINITIONS[model]
}
