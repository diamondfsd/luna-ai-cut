export function canQueueLiveStreamInput(
  bufferedBytes: number,
  incomingBytes: number,
  maxBufferedBytes: number,
): boolean {
  return Number.isFinite(bufferedBytes)
    && Number.isFinite(incomingBytes)
    && Number.isFinite(maxBufferedBytes)
    && bufferedBytes >= 0
    && incomingBytes >= 0
    && maxBufferedBytes >= 0
    && bufferedBytes + incomingBytes <= maxBufferedBytes
}
