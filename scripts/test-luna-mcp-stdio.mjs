import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { createInterface } from 'node:readline'

const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'luna-mcp-stdio-'))
const requestHeaders = []
const server = createServer(async (request, response) => {
  requestHeaders.push(request.headers)
  const chunks = []
  for await (const chunk of request) chunks.push(Buffer.from(chunk))
  const message = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  const result = message.method === 'initialize'
    ? {
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'test', version: '1' },
      }
    : message.method === 'tools/list'
      ? { tools: [{ name: 'test_tool', inputSchema: { type: 'object' } }] }
      : { content: [{ type: 'text', text: JSON.stringify({ ok: true, name: message.params.name }) }] }
  response.setHeader('Content-Type', 'application/json')
  response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }))
})

try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  assert.ok(address && typeof address !== 'string')
  const endpointPath = path.join(temporaryRoot, 'endpoint.json')
  await writeFile(endpointPath, JSON.stringify({
    version: 1,
    url: `http://127.0.0.1:${address.port}/rpc`,
  }))

  const child = spawn(process.execPath, [path.resolve(import.meta.dirname, 'luna-mcp.mjs')], {
    env: { ...process.env, LUNA_MCP_ENDPOINT: endpointPath },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const output = createInterface({ input: child.stdout, crlfDelay: Infinity })
  const outputIterator = output[Symbol.asyncIterator]()
  const nextResponse = async () => {
    const next = outputIterator.next()
    const result = await next
    return JSON.parse(result.value)
  }

  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} })}\n`)
  assert.equal((await nextResponse()).result.serverInfo.name, 'test')
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} })}\n`)
  assert.equal((await nextResponse()).result.tools[0].name, 'test_tool')
  assert.equal(requestHeaders.every((headers) => headers.authorization === undefined), true)

  child.kill()
  output.close()
  console.log('Luna MCP stdio bridge passed')
} finally {
  await new Promise((resolve) => server.close(resolve))
  await rm(temporaryRoot, { recursive: true, force: true })
}
