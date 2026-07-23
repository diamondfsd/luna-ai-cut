import * as http from 'node:http'
import * as https from 'node:https'

export interface DirectHttpInit {
  method?: string
  headers?: Record<string, string>
  signal?: AbortSignal
  timeoutMs?: number
}

/** 相机热点只提供局域网服务，明确使用直连，不经过系统 HTTP 代理。 */
export function directHttpFetch(urlText: string, init: DirectHttpInit = {}): Promise<Response> {
  const url = new URL(urlText)
  const transport = url.protocol === 'https:' ? https : http
  const timeoutMs = init.timeoutMs ?? 5000

  return new Promise((resolve, reject) => {
    let settled = false
    const request = transport.request({
      protocol: url.protocol,
      hostname: url.hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method: init.method ?? 'GET',
      headers: init.headers,
      agent: false,
    }, (response) => {
      const chunks: Buffer[] = []
      response.on('data', (chunk: Buffer | string) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
      response.on('end', () => {
        if (settled) return
        settled = true
        const headers = new Headers()
        for (const [key, value] of Object.entries(response.headers)) {
          if (Array.isArray(value)) value.forEach((item) => headers.append(key, item))
          else if (value !== undefined) headers.set(key, value)
        }
        resolve(new Response(Buffer.concat(chunks), {
          status: response.statusCode ?? 0,
          statusText: response.statusMessage,
          headers,
        }))
      })
    })

    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      request.destroy()
      reject(error)
    }

    request.setTimeout(timeoutMs, () => fail(new Error(`直连请求超时：${url.hostname}:${url.port || 80}`)))
    request.once('error', fail)

    if (init.signal) {
      if (init.signal.aborted) {
        fail(new Error('直连请求已取消'))
        return
      }
      init.signal.addEventListener('abort', () => fail(new Error('直连请求已取消')), { once: true })
    }

    request.end()
  })
}
