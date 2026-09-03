/** Encodes the DJI DUML media-delete payload documented by Osmosis. */
export function buildDjiDeletePayload(handles: readonly number[], counter: number): Buffer {
  if (handles.length === 0) throw new Error('DJI 删除命令不能没有素材句柄')
  if (handles.length > 0xff) throw new Error('DJI 一次最多删除 255 个素材')
  if (!isUint32(counter)) throw new Error('DJI 删除命令序号无效')

  const uniqueHandles = new Set<number>()
  for (const handle of handles) {
    if (!isUint32(handle) || handle === 0) throw new Error('DJI 素材句柄无效')
    if (uniqueHandles.has(handle)) throw new Error('DJI 删除命令包含重复素材句柄')
    uniqueHandles.add(handle)
  }

  const payload = Buffer.alloc(14 + handles.length * 4)
  payload[0] = handles.length
  handles.forEach((handle, index) => payload.writeUInt32LE(handle >>> 0, 1 + index * 4))
  const tailOffset = 1 + handles.length * 4
  payload.writeUInt32LE(counter >>> 0, tailOffset)
  payload[tailOffset + 4] = 0
  payload.writeUInt32LE(handles.length, tailOffset + 5)
  payload[tailOffset + 9] = 1
  payload[tailOffset + 10] = 1
  return payload
}

function isUint32(value: number): boolean {
  return Number.isInteger(value) && value >= 0 && value <= 0xffffffff
}
