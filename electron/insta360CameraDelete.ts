import { directHttpFetch } from './directHttp'
import { buildDeleteFilesBody } from './insta360DeleteCodec'
import type { CameraDeleteResult } from '../src/shared/types'

const CODE_DELETE_FILES = 12

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function verifyDeleted(host: string, cameraPath: string): Promise<string | null> {
  const encodedPath = cameraPath.split('/').map((part) => encodeURIComponent(part)).join('/')
  const url = `http://${host}${encodedPath}`
  let lastStatus = 0
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt > 0) await delay(400 * attempt)
    try {
      const response = await directHttpFetch(url, {
        method: 'HEAD',
        headers: { 'Cache-Control': 'no-cache' },
        timeoutMs: 3000,
      })
      lastStatus = response.status
      if (response.status === 404) return null
    } catch (error) {
      if (attempt === 5) return error instanceof Error ? error.message : String(error)
    }
  }
  return lastStatus === 200 ? '相机仍能访问该素材' : `无法确认删除结果（状态 ${lastStatus || '未知'}）`
}

export async function deleteCameraPaths(params: {
  host: string
  cameraPaths: string[]
  sendCommand: (code: number, body: Buffer, timeoutMs: number) => Promise<unknown>
}): Promise<CameraDeleteResult> {
  const uniquePaths = [...new Set(params.cameraPaths)]
  if (uniquePaths.length === 0) throw new Error('没有可删除的相机素材')
  for (let offset = 0; offset < uniquePaths.length; offset += 50) {
    const batch = uniquePaths.slice(offset, offset + 50)
    await params.sendCommand(CODE_DELETE_FILES, buildDeleteFilesBody(batch), 20_000)
  }
  const deleted: string[] = []
  const failed: CameraDeleteResult['failed'] = []
  for (const cameraPath of uniquePaths) {
    const error = await verifyDeleted(params.host, cameraPath)
    if (error === null) deleted.push(cameraPath)
    else failed.push({ path: cameraPath, error })
  }
  return { deleted, failed }
}
