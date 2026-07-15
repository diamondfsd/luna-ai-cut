import { buildDeleteFilesBody } from './insta360DeleteCodec'
import { logMainInfo } from './loggerService'
import type { CameraDeleteResult } from '../src/shared/types'

const CODE_DELETE_FILES = 12

export async function deleteCameraPaths(params: {
  host: string
  cameraPaths: string[]
  sendCommand: (code: number, body: Buffer, timeoutMs: number) => Promise<unknown>
}): Promise<CameraDeleteResult> {
  const uniquePaths = [...new Set(params.cameraPaths)]
  if (uniquePaths.length === 0) throw new Error('没有可删除的相机素材')
  const startedAt = performance.now()
  for (let offset = 0; offset < uniquePaths.length; offset += 50) {
    const batch = uniquePaths.slice(offset, offset + 50)
    const batchStartedAt = performance.now()
    await params.sendCommand(CODE_DELETE_FILES, buildDeleteFilesBody(batch), 20_000)
    logMainInfo('[相机删除] 删除命令响应完成', {
      host: params.host,
      batch: Math.floor(offset / 50) + 1,
      pathCount: batch.length,
      elapsedMs: Math.round(performance.now() - batchStartedAt),
    })
  }
  logMainInfo('[相机删除] 所有删除命令发送完成，准备刷新素材列表', {
    host: params.host,
    pathCount: uniquePaths.length,
    elapsedMs: Math.round(performance.now() - startedAt),
  })
  return { deleted: uniquePaths, failed: [] }
}
