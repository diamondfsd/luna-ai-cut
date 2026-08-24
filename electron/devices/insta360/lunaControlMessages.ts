import { wireFieldVarint } from './insta360TcpCodec'

export function buildKeepAliveOptionsBody(): Buffer {
  return Buffer.concat([
    wireFieldVarint(1, 48),
    wireFieldVarint(1, 15),
    wireFieldVarint(1, 11),
  ])
}

