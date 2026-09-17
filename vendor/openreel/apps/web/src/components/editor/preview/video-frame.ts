/**
 * Capture only the decoded video pixels for preview compositing.
 *
 * The caller owns project background and layer ordering. Expanding a paused
 * video frame to the project canvas here would add opaque letterbox padding
 * that can cover lower tracks and would make paused rendering diverge from
 * native playback.
 */
export const captureNativeVideoFrame = (
  video: HTMLVideoElement,
): Promise<ImageBitmap> => createImageBitmap(video);
