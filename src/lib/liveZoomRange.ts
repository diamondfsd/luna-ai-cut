export function liveZoomMaximum(deviceMaximum: number, previewAspectRatio: number): number {
  return Math.min(deviceMaximum, previewAspectRatio < 1 ? 6 : 15)
}
