import type { RemotionSceneSpec, RemotionSceneShot, RemotionShotRecipe } from '../../../src/shared/types/remotion'

export type { RemotionSceneSpec, RemotionSceneShot, RemotionShotRecipe } from '../../../src/shared/types/remotion'

export const REMOTION_VERSION = '4.0.484' as const
export const SHOTCRAFT_COMPOSITION_ID = 'shotcraft-promo' as const

export const SUPPORTED_SHOTCRAFT_RECIPES: readonly RemotionShotRecipe[] = [
  'title-card',
  'media-zoom',
  'split-reveal',
  'paper-title-card',
  'deck-deal-flyin',
  'row-embed',
  'space-camera-moves',
  'card-flip-reveal',
  'mosaic-reframe',
]

const RECIPE_SET = new Set<RemotionShotRecipe>(SUPPORTED_SHOTCRAFT_RECIPES)

function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function nonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  return value
}

function integer(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < minimum || value > maximum) {
    throw new TypeError(`${label} must be an integer between ${minimum} and ${maximum}`)
  }
  return value
}

function textRecord(value: unknown, label: string): Record<string, string> | undefined {
  if (value === undefined) return undefined
  const input = record(value, label)
  const result: Record<string, string> = {}
  for (const [key, item] of Object.entries(input)) {
    result[nonEmptyString(key, `${label} key`)] = nonEmptyString(item, `${label}.${key}`).slice(0, 2_000)
  }
  return result
}

function shot(value: unknown, index: number, totalFrames: number): RemotionSceneShot {
  const input = record(value, `shots[${index}]`)
  const recipe = nonEmptyString(input.recipe, `shots[${index}].recipe`) as RemotionShotRecipe
  if (!RECIPE_SET.has(recipe)) throw new TypeError(`Unsupported Shotcraft recipe: ${recipe}`)
  const from = integer(input.from, `shots[${index}].from`, 0, totalFrames - 1)
  const durationInFrames = integer(
    input.durationInFrames,
    `shots[${index}].durationInFrames`,
    1,
    totalFrames,
  )
  if (from + durationInFrames > totalFrames) {
    throw new RangeError(`shots[${index}] exceeds durationInFrames`)
  }
  const mediaIdsValue = input.mediaIds
  if (!Array.isArray(mediaIdsValue) || mediaIdsValue.some((item) => typeof item !== 'string')) {
    throw new TypeError(`shots[${index}].mediaIds must be an array of strings`)
  }
  if (mediaIdsValue.length > 8) throw new RangeError(`shots[${index}].mediaIds is too large`)
  return {
    id: nonEmptyString(input.id, `shots[${index}].id`),
    recipe,
    from,
    durationInFrames,
    mediaIds: [...new Set(mediaIdsValue.map((item) => nonEmptyString(item, `shots[${index}].mediaIds`)))],
    ...(textRecord(input.text, `shots[${index}].text`) ? { text: textRecord(input.text, `shots[${index}].text`) } : {}),
  }
}

export function parseRemotionSceneSpec(value: unknown): RemotionSceneSpec {
  const input = record(value, 'scene')
  if (input.version !== 1) throw new TypeError('scene.version must be 1')
  if (input.composition !== SHOTCRAFT_COMPOSITION_ID) {
    throw new TypeError(`scene.composition must be ${SHOTCRAFT_COMPOSITION_ID}`)
  }
  const width = integer(input.width, 'scene.width', 320, 3_840)
  const height = integer(input.height, 'scene.height', 320, 3_840)
  const fps = integer(input.fps, 'scene.fps', 1, 60)
  const durationInFrames = integer(input.durationInFrames, 'scene.durationInFrames', fps, fps * 60)
  if (!Array.isArray(input.shots) || input.shots.length === 0 || input.shots.length > 24) {
    throw new TypeError('scene.shots must contain between 1 and 24 shots')
  }
  const shots = input.shots.map((item, index) => shot(item, index, durationInFrames))
  if (new Set(shots.map((item) => item.id)).size !== shots.length) {
    throw new TypeError('scene.shots ids must be unique')
  }
  return { version: 1, composition: SHOTCRAFT_COMPOSITION_ID, width, height, fps, durationInFrames, shots }
}

export function mediaIdsForScene(scene: RemotionSceneSpec): string[] {
  return [...new Set(scene.shots.flatMap((item) => item.mediaIds))]
}
