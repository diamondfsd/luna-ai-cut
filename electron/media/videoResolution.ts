export interface FfprobeVideoEntry {
  media_type?: unknown
  codec_type?: unknown
  index?: unknown
  stream_index?: unknown
  width?: unknown
  height?: unknown
  side_data_list?: Array<{ rotation?: unknown }>
  tags?: Record<string, unknown>
  disposition?: {
    attached_pic?: unknown
  }
}

function dimension(value: unknown): number {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? number : 0
}

/** Select the encoded video stream, never an attached-pic thumbnail stream. */
export function selectPrimaryVideoStream(
  streams: readonly FfprobeVideoEntry[] | undefined,
): FfprobeVideoEntry | undefined {
  let selected: FfprobeVideoEntry | undefined
  let selectedArea = 0

  for (const candidate of streams ?? []) {
    if (candidate.codec_type !== 'video' || Number(candidate.disposition?.attached_pic) === 1) continue
    const area = dimension(candidate.width) * dimension(candidate.height)
    if (!selected || area > selectedArea) {
      selected = candidate
      selectedArea = area
    }
  }

  return selected
}

export function selectVideoFrame(
  frames: readonly FfprobeVideoEntry[] | undefined,
  stream: FfprobeVideoEntry | undefined,
): FfprobeVideoEntry | undefined {
  const videoFrames = (frames ?? []).filter((frame) => frame.media_type === 'video')
  const streamIndex = Number(stream?.index)
  if (Number.isFinite(streamIndex)) {
    return videoFrames.find((frame) => Number(frame.stream_index) === streamIndex)
  }
  return videoFrames[0]
}
