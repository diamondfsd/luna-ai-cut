function wireVarint(value: number): Buffer {
  const out: number[] = []
  let next = value >>> 0
  while (next > 0x7f) {
    out.push((next & 0x7f) | 0x80)
    next >>>= 7
  }
  out.push(next & 0x7f)
  return Buffer.from(out)
}

function wireString(value: string): Buffer {
  const bytes = Buffer.from(value, 'utf8')
  return Buffer.concat([Buffer.from([0x0a]), wireVarint(bytes.length), bytes])
}

/** DeleteFiles { repeated string uri = 1 } */
export function buildDeleteFilesBody(cameraPaths: string[]): Buffer {
  if (cameraPaths.length === 0) throw new Error('没有可删除的相机素材')
  return Buffer.concat(cameraPaths.map(wireString))
}
