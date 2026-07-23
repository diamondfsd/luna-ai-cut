export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface VideoTrimState {
  /** Trim start time in seconds. */
  startTime: number
  /** Trim end time in seconds. */
  endTime: number
}
