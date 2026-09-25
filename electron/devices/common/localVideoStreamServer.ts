import { createServer, type Server, type ServerResponse } from 'node:http'

export interface LocalVideoStreamInfo {
  url: string
  port: number
}

const PRE_CLIENT_BUFFER_BYTES = 4 * 1024 * 1024

/**
 * Keeps high-rate video bytes out of Electron IPC. Device adapters publish
 * frames here and the renderer reads one normal localhost HTTP stream.
 */
export class LocalVideoStreamServer {
  private readonly contentType: string
  private readonly preferredPort: number
  private readonly preClientBufferBytes: number
  private server: Server | null = null
  private readonly clients = new Set<ServerResponse>()
  private readonly preClientFrames: Buffer[] = []
  private preClientBytes = 0

  constructor(
    contentType = 'application/octet-stream',
    preferredPort = 0,
    preClientBufferBytes = PRE_CLIENT_BUFFER_BYTES,
  ) {
    this.contentType = contentType
    this.preferredPort = Number.isInteger(preferredPort) && preferredPort >= 0 && preferredPort <= 65_535
      ? preferredPort
      : 0
    this.preClientBufferBytes = Number.isFinite(preClientBufferBytes) && preClientBufferBytes > 0
      ? Math.floor(preClientBufferBytes)
      : 0
  }

  async start(): Promise<LocalVideoStreamInfo> {
    if (this.server) {
      const address = this.server.address()
      if (address && typeof address !== 'string') {
        return { url: `http://127.0.0.1:${address.port}/stream`, port: address.port }
      }
    }

    const createStreamServer = () => createServer((request, response) => {
      const requestUrl = new URL(request.url ?? '/', 'http://127.0.0.1')
      if (request.method === 'OPTIONS') {
        response.writeHead(204, this.headers())
        response.end()
        return
      }
      if (request.method !== 'GET' || requestUrl.pathname !== '/stream') {
        response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' })
        response.end('Not found')
        return
      }

      response.writeHead(200, this.headers())
      response.flushHeaders()
      this.clients.add(response)
      this.flushPreClientFrames(response)
      const remove = () => this.clients.delete(response)
      response.once('close', remove)
      request.once('aborted', remove)
    })

    const maxAttempts = this.preferredPort > 0 ? 100 : 1
    let server: Server | null = null
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      const candidate = createStreamServer()
      const port = this.preferredPort > 0 ? this.preferredPort + attempt : 0
      try {
        await new Promise<void>((resolve, reject) => {
          const onError = (error: Error) => {
            candidate.off('listening', onListening)
            reject(error)
          }
          const onListening = () => {
            candidate.off('error', onError)
            resolve()
          }
          candidate.once('error', onError)
          candidate.once('listening', onListening)
          candidate.listen({ host: '127.0.0.1', port })
        })
        server = candidate
        break
      } catch (error) {
        await new Promise<void>((resolve) => candidate.close(() => resolve()))
        const code = (error as NodeJS.ErrnoException).code
        if (code !== 'EADDRINUSE' || this.preferredPort === 0 || attempt === maxAttempts - 1) throw error
      }
    }

    if (!server) throw new Error('无法获取本地视频流端口')

    this.server = server
    const address = server.address()
    if (!address || typeof address === 'string') {
      await this.stop()
      throw new Error('无法获取本地视频流端口')
    }
    return { url: `http://127.0.0.1:${address.port}/stream`, port: address.port }
  }

  publish(frame: Buffer): void {
    if (this.clients.size === 0) {
      this.queuePreClientFrame(frame)
      return
    }
    for (const client of this.clients) {
      if (client.destroyed || client.writableEnded) {
        this.clients.delete(client)
        continue
      }
      // Dropping a frame while a renderer is behind is preferable to building
      // an unbounded response buffer. The camera will send another keyframe.
      if (client.writableNeedDrain) continue
      client.write(frame)
    }
  }

  async stop(): Promise<void> {
    for (const client of this.clients) client.destroy()
    this.clients.clear()
    this.preClientFrames.length = 0
    this.preClientBytes = 0
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }

  private headers(): Record<string, string> {
    return {
      'Content-Type': this.contentType,
      'Cache-Control': 'no-store',
      'Access-Control-Allow-Origin': '*',
      Connection: 'keep-alive',
    }
  }

  private queuePreClientFrame(frame: Buffer): void {
    if (this.preClientBufferBytes === 0) return
    const copy = Buffer.from(frame)
    this.preClientFrames.push(copy)
    this.preClientBytes += copy.length
    while (this.preClientBytes > this.preClientBufferBytes && this.preClientFrames.length > 1) {
      const first = this.preClientFrames.shift()!
      this.preClientBytes -= first.length
    }
  }

  private flushPreClientFrames(response: ServerResponse): void {
    for (const frame of this.preClientFrames) response.write(frame)
    this.preClientFrames.length = 0
    this.preClientBytes = 0
  }
}
