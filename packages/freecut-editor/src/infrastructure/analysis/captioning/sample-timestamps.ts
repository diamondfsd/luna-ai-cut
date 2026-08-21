import type { CaptionTimeRange } from './types'

export const MAX_VIDEO_CAPTION_SAMPLES = 400
export const MAX_TARGETED_VIDEO_CAPTION_SAMPLES = 48

const END_SAMPLE_MARGIN_SEC = 0.1
const DEFAULT_SAMPLE_INTERVAL_SEC = 3

function normalizeInterval(intervalSec: number): number {
  return Number.isFinite(intervalSec) && intervalSec > 0 ? intervalSec : DEFAULT_SAMPLE_INTERVAL_SEC
}

function normalizeMaxSamples(maxSamples: number): number {
  return Number.isInteger(maxSamples) && maxSamples > 0 ? maxSamples : MAX_VIDEO_CAPTION_SAMPLES
}

/**
 * Increase the requested cadence only when its sample count would exceed the
 * cap. The adjusted cadence still leaves a sample near the end of the video.
 */
export function resolveCaptioningIntervalForDuration(
  intervalSec: number,
  durationSec: number,
  maxSamples = MAX_VIDEO_CAPTION_SAMPLES,
): number {
  const normalizedInterval = normalizeInterval(intervalSec)
  const normalizedMaxSamples = normalizeMaxSamples(maxSamples)
  if (!Number.isFinite(durationSec) || durationSec <= 0 || normalizedMaxSamples <= 1) {
    return normalizedInterval
  }

  const requestedSampleCount = Math.ceil(durationSec / normalizedInterval)
  if (requestedSampleCount < normalizedMaxSamples) return normalizedInterval

  const cappedInterval =
    Math.max(0, durationSec - END_SAMPLE_MARGIN_SEC) / (normalizedMaxSamples - 1)
  return Math.max(normalizedInterval, cappedInterval)
}

/**
 * Build stable video timestamps without ever returning more than maxSamples.
 * Short videos retain the requested cadence; long videos are evenly spread
 * across the full duration so the final sample remains useful.
 */
export function buildCaptionTimestamps(
  durationSec: number,
  intervalSec: number,
  maxSamples = MAX_VIDEO_CAPTION_SAMPLES,
): number[] {
  const normalizedMaxSamples = normalizeMaxSamples(maxSamples)
  if (!Number.isFinite(durationSec) || durationSec <= 0) return []

  const effectiveInterval = resolveCaptioningIntervalForDuration(
    intervalSec,
    durationSec,
    normalizedMaxSamples,
  )
  const timestamps: number[] = []
  for (let time = 0; time < durationSec; time += effectiveInterval) {
    timestamps.push(time)
    if (timestamps.length > normalizedMaxSamples) break
  }

  const lastTimestamp = timestamps[timestamps.length - 1]
  if (
    timestamps.length > 0 &&
    lastTimestamp !== undefined &&
    lastTimestamp + effectiveInterval * 0.5 < durationSec
  ) {
    timestamps.push(Math.max(0, durationSec - END_SAMPLE_MARGIN_SEC))
  }

  if (timestamps.length <= normalizedMaxSamples) return timestamps

  const lastSampleTime = Math.max(0, durationSec - END_SAMPLE_MARGIN_SEC)
  return Array.from({ length: normalizedMaxSamples }, (_, index) =>
    index === normalizedMaxSamples - 1
      ? lastSampleTime
      : (lastSampleTime * index) / (normalizedMaxSamples - 1),
  )
}

function normalizeTimeRanges(
  ranges: readonly CaptionTimeRange[],
  durationSec: number,
): CaptionTimeRange[] {
  const normalized = ranges
    .map((range) => ({
      startSeconds: Math.max(0, Math.min(durationSec, range.startSeconds)),
      endSeconds: Math.max(0, Math.min(durationSec, range.endSeconds)),
    }))
    .filter((range) => Number.isFinite(range.startSeconds) && Number.isFinite(range.endSeconds))
    .filter((range) => range.endSeconds > range.startSeconds)
    .toSorted((left, right) => left.startSeconds - right.startSeconds)

  const merged: CaptionTimeRange[] = []
  for (const range of normalized) {
    const previous = merged.at(-1)
    if (previous && range.startSeconds <= previous.endSeconds) {
      previous.endSeconds = Math.max(previous.endSeconds, range.endSeconds)
    } else {
      merged.push({ ...range })
    }
  }
  return merged
}

/**
 * Build timestamps only inside transcript-selected source ranges. Each range gets an opening
 * frame and a frame near its end, while the global cap keeps a large batch of ranges bounded.
 */
export function buildCaptionTimestampsForRanges(
  durationSec: number,
  intervalSec: number,
  ranges: readonly CaptionTimeRange[],
  maxSamples = MAX_TARGETED_VIDEO_CAPTION_SAMPLES,
): number[] {
  const normalizedMaxSamples = normalizeMaxSamples(maxSamples)
  if (!Number.isFinite(durationSec) || durationSec <= 0 || ranges.length === 0) return []

  const effectiveInterval = normalizeInterval(intervalSec)
  const normalizedRanges = normalizeTimeRanges(ranges, durationSec)
  const timestamps: number[] = []
  const seen = new Set<number>()
  const latestFrameTime = Math.max(0, durationSec - END_SAMPLE_MARGIN_SEC)

  const add = (time: number) => {
    const rounded =
      Math.round(Math.max(0, Math.min(latestFrameTime, time)) * 10) / 10
    if (!seen.has(rounded) && timestamps.length < normalizedMaxSamples) {
      seen.add(rounded)
      timestamps.push(rounded)
    }
  }

  const requestedCounts = normalizedRanges.map(
    (range) => Math.max(2, Math.ceil((range.endSeconds - range.startSeconds) / effectiveInterval)),
  )
  const requestedTotal = requestedCounts.reduce((total, count) => total + count, 0)

  if (requestedTotal <= normalizedMaxSamples) {
    for (const range of normalizedRanges) {
      for (
        let time = range.startSeconds;
        time < range.endSeconds && timestamps.length < normalizedMaxSamples;
        time += effectiveInterval
      ) {
        add(time)
      }
      add(Math.max(range.startSeconds, range.endSeconds - END_SAMPLE_MARGIN_SEC))
    }
  } else if (normalizedMaxSamples === 1) {
    add(normalizedRanges[0]?.startSeconds ?? 0)
  } else if (normalizedMaxSamples < normalizedRanges.length) {
    // There are more ranges than available samples. Select evenly across the ordered ranges so
    // the cap still gives the model a view of the beginning, middle, and end of the evidence.
    for (let index = 0; index < normalizedMaxSamples; index += 1) {
      const rangeIndex = Math.round(
        (index * (normalizedRanges.length - 1)) / (normalizedMaxSamples - 1),
      )
      add(normalizedRanges[rangeIndex]?.startSeconds ?? 0)
    }
  } else {
    // Preserve evidence from every selected range when the global cap is reached. Each range
    // gets its opening and closing frame first; remaining slots are distributed by range length
    // instead of allowing the earliest range to consume the entire budget.
    const rangeCount = normalizedRanges.length
    const baseCount = Math.min(2, Math.floor(normalizedMaxSamples / rangeCount))
    const counts = normalizedRanges.map(() => baseCount)
    let remaining = normalizedMaxSamples - baseCount * rangeCount
    const rankedRanges = normalizedRanges
      .map((range, index) => ({
        index,
        weight: range.endSeconds - range.startSeconds,
      }))
      .toSorted((left, right) => right.weight - left.weight)

    for (let index = 0; remaining > 0; index += 1) {
      const target = rankedRanges[index % rankedRanges.length]!
      counts[target.index]! += 1
      remaining -= 1
    }

    for (const [index, range] of normalizedRanges.entries()) {
      const count = counts[index]!
      if (count === 1) {
        add(range.startSeconds)
        continue
      }
      const end = Math.max(range.startSeconds, range.endSeconds - END_SAMPLE_MARGIN_SEC)
      for (let sampleIndex = 0; sampleIndex < count; sampleIndex += 1) {
        add(range.startSeconds + ((end - range.startSeconds) * sampleIndex) / (count - 1))
      }
    }
  }

  return timestamps.toSorted((left, right) => left - right)
}
