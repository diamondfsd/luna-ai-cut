import { appToolRegistry } from './lunaAppToolModules.ts'
import { agentSkillIndex } from '../features/agent-skills/agentSkillIndex.ts'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { agentPersonalSpace } from '../features/agent-space/agentPersonalSpace.ts'
import { asRecord, type JsonRpcResponse, type LunaMcpServerOptions, type LunaMcpServer, type LunaMcpEndpoint } from './lunaMcpProtocol.ts'
import { getToolCatalog, openApiDocument } from './lunaMcpCatalog.ts'
import { handleRpc } from './lunaMcpRpc.ts'
export type { LunaMcpServerOptions, LunaMcpServer, LunaMcpEndpoint, LunaHttpConnection } from './lunaMcpProtocol.ts'

const MAX_BODY_BYTES = 2 * 1024 * 1024

function endpointPathFor(homeDir: string): string {
  return agentPersonalSpace(homeDir).endpointPath
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

function httpToolPayload(rpcResponse: JsonRpcResponse): Record<string, unknown> {
  if (rpcResponse.error) {
    return {
      ok: false,
      summary: rpcResponse.error.message,
      error: {
        code: `RPC_${rpcResponse.error.code}`,
        message: rpcResponse.error.message,
      },
    }
  }

  const rpcResult = asRecord(rpcResponse.result)
  const structured = asRecord(rpcResult?.structuredContent)
  const content = Array.isArray(rpcResult?.content) ? rpcResult?.content : undefined
  if (!structured) {
    return {
      ok: false,
      summary: '工具返回了无效结果',
      ...(content ? { content } : {}),
    }
  }

  // HTTP callers receive the domain result directly while retaining task context and images.
  const nested = asRecord(structured.result)
  const sessionContext = asRecord(asRecord(structured.data)?.lunaAgent)
  const payload = nested && typeof nested.ok === 'boolean'
    ? {
        ...nested,
        ...(sessionContext
          ? { data: { ...(asRecord(nested.data) ?? {}), lunaAgent: sessionContext } }
          : {}),
      }
    : { ...structured }
  return {
    ...payload,
    ...(content ? { content } : {}),
    ...(rpcResult?.isError === true ? { isError: true } : {}),
  }
}

function writeText(response: ServerResponse, status: number, value: string, contentType: string): void {
  response.statusCode = status
  response.setHeader('Content-Type', contentType)
  response.setHeader('Content-Length', Buffer.byteLength(value))
  response.end(value)
}

function setCorsHeaders(response: ServerResponse): void {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
}

async function handleHttpRequest(
  request: IncomingMessage,
  response: ServerResponse,
  baseUrl: string,
  options: LunaMcpServerOptions,
): Promise<void> {
  setCorsHeaders(response)
  if (request.method === 'OPTIONS') {
    response.statusCode = 204
    response.end()
    return
  }

  const pathname = new URL(request.url ?? '/', 'http://127.0.0.1').pathname
  if (request.method === 'GET' && (pathname === '/' || pathname === '/.well-known/agent')) {
    writeJson(response, 200, {
      name: 'Luna AI Cut',
      agent: true,
      protocol: 'http',
      version: '1.0.0',
      baseUrl,
      skill: `${baseUrl}/skill.md`,
      skillIndex: `${baseUrl}/skills/index.md`,
      tools: `${baseUrl}/tools`,
      openapi: `${baseUrl}/openapi.json`,
      api: `${baseUrl}/api/tools/{toolName}`,
    })
    return
  }

  if (request.method === 'GET' && pathname.startsWith('/skills/')) {
    const registry = appToolRegistry(options)
    const skill = registry.skills.find(item => pathname === `/skills/${item.id}.md`)
    if (pathname === '/skills/index.md' || skill) {
      response.setHeader('Cache-Control', 'no-store')
      writeText(response, 200, skill?.instructions ?? agentSkillIndex(registry.skills), 'text/markdown; charset=utf-8')
      return
    }
  }

  if (request.method === 'GET' && pathname === '/skill.md') {
    response.setHeader('Cache-Control', 'no-store')
    writeText(response, 200, agentSkillIndex(appToolRegistry(options).skills), 'text/markdown; charset=utf-8')
    return
  }

  if (request.method === 'GET' && (pathname === '/tools' || pathname === '/openapi.json')) {
    const catalog = await getToolCatalog(options)
    if (pathname === '/tools') {
      writeJson(response, 200, {
        ok: true,
        tools: catalog.tools,
        meta: { luna: { workflowSkills: '/skills/index.md' } },
      })
    } else {
      writeJson(response, 200, openApiDocument(baseUrl, catalog))
    }
    return
  }

  if (request.method !== 'POST' || (pathname !== '/rpc' && !pathname.startsWith('/api/tools/'))) {
    writeJson(response, 404, { error: 'Not found' })
    return
  }
  try {
    const body = await readBody(request)
    const parsed = body.trim() ? JSON.parse(body) as unknown : {}
    if (pathname.startsWith('/api/tools/')) {
      const encodedName = pathname.slice('/api/tools/'.length)
      const name = decodeURIComponent(encodedName)
      if (!name || name.includes('/')) {
        writeJson(response, 404, { error: 'Tool not found' })
        return
      }
      const bodyRecord = asRecord(parsed) ?? {}
      const args = asRecord(bodyRecord.arguments) ?? bodyRecord
      const rpcResponse = await handleRpc({
        jsonrpc: '2.0',
        id: randomUUID(),
        method: 'tools/call',
        params: { name, arguments: args },
      }, options)
      if (!rpcResponse) {
        response.statusCode = 204
        response.end()
        return
      }
      writeJson(response, 200, httpToolPayload(rpcResponse))
      return
    }
    const result = await handleRpc(parsed, options)
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
  let startPromise: Promise<LunaMcpEndpoint> | null = null
  let baseUrl = ''

  return {
    endpointPath,
    async start(): Promise<LunaMcpEndpoint> {
      if (server && endpoint) return endpoint
      if (startPromise) return startPromise

      startPromise = (async () => {
        server = createServer((request, response) => {
          void handleHttpRequest(request, response, baseUrl, options)
        })
        await new Promise<void>((resolve, reject) => {
          const current = server as Server
          current.once('error', reject)
          current.listen(0, '127.0.0.1', () => {
            current.off('error', reject)
            resolve()
          })
        })

        const address = server?.address()
        if (!address || typeof address === 'string') throw new Error('本机 Agent 服务启动失败')
        baseUrl = `http://127.0.0.1:${address.port}`
        endpoint = {
          version: 1,
          url: `${baseUrl}/rpc`,
          baseUrl,
          skillUrl: `${baseUrl}/skill.md`,
          toolsUrl: `${baseUrl}/tools`,
          openapiUrl: `${baseUrl}/openapi.json`,
          apiUrl: `${baseUrl}/api/tools/{toolName}`,
          pid: process.pid,
        }
        await mkdir(path.dirname(endpointPath), { recursive: true, mode: 0o700 })
        const temporaryEndpoint = `${endpointPath}.${randomUUID()}.tmp`
        try {
          await writeFile(temporaryEndpoint, `${JSON.stringify(endpoint, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 })
          await rename(temporaryEndpoint, endpointPath)
        } finally { await rm(temporaryEndpoint, { force: true }) }
        return endpoint
      })()

      try {
        return await startPromise
      } catch (error) {
        startPromise = null
        const current = server
        server = null
        baseUrl = ''
        if (current) await new Promise<void>((resolve) => current.close(() => resolve()))
        throw error
      }
    },
    async getEndpoint(): Promise<LunaMcpEndpoint> {
      return await this.start()
    },
    async stop(): Promise<void> {
      const current = server
      server = null
      endpoint = null
      baseUrl = ''
      startPromise = null
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
