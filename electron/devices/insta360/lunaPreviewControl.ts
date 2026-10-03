import { parseWireFields } from './lunaBleCodec.ts'
import {
  ACCESS_CAMERA_FILE_STATE_IDLE,
  ACCESS_CAMERA_FILE_STATE_LIVE_VIEW,
  buildAccessCameraFileStateBody,
  buildStartLiveStreamBody,
  CODE_GET_FIRMWARE_VERSIONS,
  CODE_SET_ACCESS_CAMERA_FILE_STATE,
  CODE_START_LIVE_STREAM,
  CODE_STOP_LIVE_STREAM,
} from './lunaControlMessages.ts'

interface PreviewSession {
  sendCommand(code: number, body: Buffer, timeoutMs: number): Promise<{ code: number; body: Buffer }>
}

/** Mobile app enables preview access for primary firmware 1.1.8 and later. */
export function supportsPreviewAccessState(body: Buffer): boolean {
  for (const module of parseWireFields(body).get(1) ?? []) {
    if (!Buffer.isBuffer(module.value)) continue
    const fields = parseWireFields(module.value)
    if (fields.get(1)?.[0]?.value !== 1) continue
    const version = fields.get(2)?.[0]?.value
    if (!Buffer.isBuffer(version)) return false
    const match = /^(\d+)\.(\d+)\.(\d+)/.exec(version.toString('utf8').trim())
    if (!match) return false
    const [major, minor, patch] = match.slice(1).map(Number)
    return major > 1 || (major === 1 && (minor > 1 || (minor === 1 && patch >= 8)))
  }
  return false
}

async function command(session: PreviewSession, code: number, body = Buffer.alloc(0)): Promise<void> {
  const response = await session.sendCommand(code, body, 5000)
  if (response.code !== 200) throw new Error(`相机预览操作失败（${response.code}）`)
}

/** Paired access-state lifecycle; callers serialize operations with the control session. */
export class LunaPreviewControl {
  private accessOpen = false

  async start(session: PreviewSession): Promise<void> {
    // Older firmware may not implement the version query, matching the app's fallback.
    const supportsAccess = await session.sendCommand(CODE_GET_FIRMWARE_VERSIONS, Buffer.alloc(0), 5000)
      .then((response) => response.code === 200 && supportsPreviewAccessState(response.body))
      .catch(() => false)
    if (supportsAccess) {
      // Also restore idle if the request times out after the camera acted on it.
      this.accessOpen = true
    }
    try {
      if (supportsAccess) {
        await command(session, CODE_SET_ACCESS_CAMERA_FILE_STATE, buildAccessCameraFileStateBody(ACCESS_CAMERA_FILE_STATE_LIVE_VIEW))
      }
      await command(session, CODE_START_LIVE_STREAM, buildStartLiveStreamBody())
    } catch (error) {
      await this.stop(session).catch(() => undefined)
      throw error
    }
  }

  async stop(session: PreviewSession): Promise<void> {
    try {
      await command(session, CODE_STOP_LIVE_STREAM)
    } finally {
      if (this.accessOpen) {
        await command(session, CODE_SET_ACCESS_CAMERA_FILE_STATE, buildAccessCameraFileStateBody(ACCESS_CAMERA_FILE_STATE_IDLE))
        this.accessOpen = false
      }
    }
  }
}
