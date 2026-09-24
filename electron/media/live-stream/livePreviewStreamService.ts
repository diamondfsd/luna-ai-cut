import { LocalVideoStreamServer } from '../../devices/common/localVideoStreamServer'

export interface LivePreviewStatus {
  url: string | null
  port: number | null
  frames: number
  error: string | null
}

/** Forwards raw Annex-B HEVC frames to the renderer for WebCodecs preview. */
export class LivePreviewStreamService {
  private readonly server = new LocalVideoStreamServer('video/hevc')
  private statusValue: LivePreviewStatus = { url: null, port: null, frames: 0, error: null }

  async start(): Promise<LivePreviewStatus> {
    if (this.statusValue.url) return this.status()
    try {
      const local = await this.server.start()
      this.statusValue = { ...this.statusValue, url: local.url, port: local.port, error: null }
    } catch (error) {
      this.statusValue = {
        ...this.statusValue,
        error: error instanceof Error ? error.message : String(error),
      }
    }
    return this.status()
  }

  pushHevcFrame(frame: Buffer): void {
    if (frame.length === 0) return
    this.server.publish(frame)
    this.statusValue = { ...this.statusValue, frames: this.statusValue.frames + 1, error: null }
  }

  status(): LivePreviewStatus {
    return { ...this.statusValue }
  }

  async stop(): Promise<void> {
    await this.server.stop()
    this.statusValue = { url: null, port: null, frames: 0, error: null }
  }
}
