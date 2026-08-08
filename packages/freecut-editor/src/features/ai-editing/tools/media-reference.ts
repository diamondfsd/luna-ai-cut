const MEDIA_REFERENCE_PREFIX = 'media:'

export function mediaIdFromToolInput(value: string): string {
  return value.startsWith(MEDIA_REFERENCE_PREFIX)
    ? value.slice(MEDIA_REFERENCE_PREFIX.length)
    : value
}

export function mediaIdsFromToolInput(values: readonly string[]): string[] {
  return values.map(mediaIdFromToolInput)
}
