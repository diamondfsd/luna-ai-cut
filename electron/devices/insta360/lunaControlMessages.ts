import { wireFieldVarint } from './insta360TcpCodec.ts'

export const CODE_START_LIVE_STREAM = 1
export const CODE_STOP_LIVE_STREAM = 2

/** Matches the StartLiveStream body validated against the mobile app. */
export function buildStartLiveStreamBody(): Buffer {
  return Buffer.concat([
    wireFieldVarint(2, 1),
    wireFieldVarint(6, 40),
    wireFieldVarint(7, 9),
    wireFieldVarint(8, 1),
    wireFieldVarint(9, 40),
    wireFieldVarint(10, 18),
  ])
}

export function buildKeepAliveOptionsBody(): Buffer {
  return Buffer.concat([
    wireFieldVarint(1, 48),
    wireFieldVarint(1, 15),
    wireFieldVarint(1, 11),
  ])
}
