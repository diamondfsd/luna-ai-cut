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
  private server: Server | null = null
  private readonly clients = new Set<ServerResponse>()
  private readonly preClientFrames: Buffer[] = []
  private preClientBytes = 0

  constructor(contentType = 'application/octet-stream') {
    this.contentType = contentType
  }

  async start(): Promise<LocalVideoStreamInfo> {
    if (this.server) {
      const address = this.server.address()
      if (address && typeof address !== 'string') {
        return { url: `http://127.0.0.1:${address.port}/stream`, port: address.port }
      }
    }

    const server = createServer((request, response) => {
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

    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error) => {
        server.off('listening', onListening)
        reject(error)
      }
      const onListening = () => {
        server.off('error', onError)
        resolve()
      }
      server.once('error', onError)
      server.once('listening', onListening)
      server.listen({ host: '127.0.0.1', port: 0 })
    })

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
    const copy = Buffer.from(frame)
    this.preClientFrames.push(copy)
    this.preClientBytes += copy.length
    while (this.preClientBytes > PRE_CLIENT_BUFFER_BYTES && this.preClientFrames.length > 1) {
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
