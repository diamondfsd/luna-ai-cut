import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

import type { AiEditorMcpRequest, AiEditorMcpResponse } from '../../src/shared/types'

const MCP_PROTOCOL_VERSION = '2024-11-05'
const MAX_BODY_BYTES = 2 * 1024 * 1024

type RpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc?: unknown
  id?: unknown
  method?: unknown
  params?: unknown
}

interface JsonRpcResponse {
  jsonrpc: '2.0'
  id: RpcId
  result?: unknown
  error?: {
    code: number
    message: string
    data?: unknown
  }
}

export interface LunaMcpEndpoint {
  version: 1
  url: string
  token: string
  pid: number
}

export interface LunaMcpServerOptions {
  homeDir?: string
  requestRenderer(request: AiEditorMcpRequest): Promise<AiEditorMcpResponse>
}

export interface LunaMcpServer {
  start(): Promise<LunaMcpEndpoint>
  stop(): Promise<void>
  endpointPath: string
}

function endpointPathFor(homeDir: string): string {
  return path.join(homeDir, '.luna-ai-cut', 'mcp-endpoint.json')
}

function isRpcId(value: unknown): value is RpcId {
  return value === null || typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))
}

function jsonRpcError(id: RpcId, code: number, message: string, data?: unknown): JsonRpcResponse {
  return {
    jsonrpc: '2.0',
    id,
    error: { code, message, ...(data === undefined ? {} : { data }) },
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function textForResult(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

async function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer | string) => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buffer.byteLength
      if (size > MAX_BODY_BYTES) {
        reject(new Error('请求内容过大'))
        request.destroy()
        return
      }
      chunks.push(buffer)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function writeJson(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Content-Length', Buffer.byteLength(body))
  response.end(body)
}

function authorized(request: IncomingMessage, token: string): boolean {
  return request.headers.authorization === `Bearer ${token}`
}

async function handleRpc(
  raw: unknown,
  requestRenderer: LunaMcpServerOptions['requestRenderer'],
): Promise<JsonRpcResponse | null> {
  const request = asRecord(raw) as JsonRpcRequest | null
  const rawId = request?.id
  const id = isRpcId(rawId) ? rawId : null
  const method = typeof request?.method === 'string' ? request.method : null
  const isNotification = request !== null && !('id' in request)

  if (!request || request.jsonrpc !== '2.0' || !method) {
    return jsonRpcError(id, -32600, '无效的 JSON-RPC 请求')
  }

  if (isNotification) return null

  if (method === 'initialize') {
    const params = asRecord(request.params)
    const requestedVersion = typeof params?.protocolVersion === 'string'
      ? params.protocolVersion
      : MCP_PROTOCOL_VERSION
    return {
      jsonrpc: '2.0',
      id,
      result: {
        protocolVersion: requestedVersion,
        capabilities: { tools: {} },
        serverInfo: { name: 'luna-ai-cut', version: '0.1.0' },
      },
    }
  }

  if (method === 'ping') return { jsonrpc: '2.0', id, result: {} }

  if (method === 'tools/list') {
    const bridgeResponse = await requestRenderer({
      callId: randomUUID(),
      kind: 'listTools',
    })
    if (!bridgeResponse.ok) return jsonRpcError(id, -32000, bridgeResponse.error ?? 'AI 剪辑页面不可用')
    return { jsonrpc: '2.0', id, result: { tools: bridgeResponse.result ?? [] } }
  }

  if (method === 'tools/call') {
    const params = asRecord(request.params)
    const name = typeof params?.name === 'string' ? params.name : ''
    if (!name) return jsonRpcError(id, -32602, '缺少工具名称')
    const args = asRecord(params?.arguments) ?? {}
    const bridgeResponse = await requestRenderer({
      callId: randomUUID(),
      kind: 'callTool',
      name,
      args,
    })
    if (!bridgeResponse.ok) return jsonRpcError(id, -32000, bridgeResponse.error ?? 'AI 剪辑页面不可用')

    const toolResult = asRecord(bridgeResponse.result)
    const isError = toolResult?.ok === false
    return {
      jsonrpc: '2.0',
      id,
      result: {
        content: [{ type: 'text', text: textForResult(bridgeResponse.result) }],
        isError,
        ...(bridgeResponse.result && typeof bridgeResponse.result === 'object'
          ? { structuredContent: bridgeResponse.result }
          : {}),
      },
    }
  }

  return jsonRpcError(id, -32601, `不支持的方法: ${method}`)
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  token: string,
  requestRenderer: LunaMcpServerOptions['requestRenderer'],
): Promise<void> {
  if (request.method !== 'POST' || request.url !== '/rpc') {
    writeJson(response, 404, { error: 'Not found' })
    return
  }
  if (!authorized(request, token)) {
    writeJson(response, 401, { error: 'Unauthorized' })
    return
  }

  try {
    const body = await readBody(request)
    const parsed = JSON.parse(body) as unknown
    const result = await handleRpc(parsed, requestRenderer)
    if (result === null) {
      response.statusCode = 204
      response.end()
      return
    }
    writeJson(response, 200, result)
  } catch (error) {
    writeJson(response, 400, { error: error instanceof Error ? error.message : String(error) })
  }
}

export function createLunaMcpServer(options: LunaMcpServerOptions): LunaMcpServer {
  const homeDir = options.homeDir ?? os.homedir()
  const endpointPath = endpointPathFor(homeDir)
  let server: Server | null = null
  let endpoint: LunaMcpEndpoint | null = null

  return {
    endpointPath,
    async start(): Promise<LunaMcpEndpoint> {
      if (server && endpoint) return endpoint

      const token = randomBytes(32).toString('hex')
      server = createServer((request, response) => {
        void handleHttpRequest(request, response, token, options.requestRenderer)
      })
      await new Promise<void>((resolve, reject) => {
        const current = server as Server
        current.once('error', reject)
        current.listen(0, '127.0.0.1', () => {
          current.off('error', reject)
          resolve()
        })
      })

      const address = server.address()
      if (!address || typeof address === 'string') throw new Error('MCP 服务启动失败')
      endpoint = {
        version: 1,
        url: `http://127.0.0.1:${address.port}/rpc`,
        token,
        pid: process.pid,
      }
      await mkdir(path.dirname(endpointPath), { recursive: true })
      await writeFile(endpointPath, `${JSON.stringify(endpoint, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
      return endpoint
    },
    async stop(): Promise<void> {
      const current = server
      server = null
      endpoint = null
      if (current) {
        await new Promise<void>((resolve) => current.close(() => resolve()))
      }
      await readFile(endpointPath, 'utf8')
        .then((value) => {
          try {
            const saved = JSON.parse(value) as Partial<LunaMcpEndpoint>
            if (saved.pid === process.pid) return rm(endpointPath, { force: true })
          } catch {
            return undefined
          }
          return undefined
        })
        .catch(() => undefined)
    },
  }
}
