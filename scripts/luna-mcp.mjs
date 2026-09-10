#!/usr/bin/env node
import { createInterface } from 'node:readline'
import { readFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'

const DEFAULT_ENDPOINT = path.join(os.homedir(), '.luna-ai-cut', 'mcp-endpoint.json')
const endpointPath = process.env.LUNA_MCP_ENDPOINT
  || (process.argv[2] === '--endpoint' ? process.argv[3] : null)
  || DEFAULT_ENDPOINT

async function loadEndpoint() {
  try {
    const value = JSON.parse(await readFile(endpointPath, 'utf8'))
    if (!value || typeof value.url !== 'string' || typeof value.token !== 'string') {
      throw new Error('本机 MCP endpoint 文件无效')
    }
    return value
  } catch (error) {
    throw new Error(`无法连接 Luna AI Cut，请先启动应用（${endpointPath}）: ${error instanceof Error ? error.message : String(error)}`)
  }
}

function rpcError(id, message) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code: -32000, message } }
}

async function forward(message) {
  const endpoint = await loadEndpoint()
  const response = await fetch(endpoint.url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${endpoint.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(message),
  })
  if (response.status === 204) return null
  const text = await response.text()
  if (!response.ok) throw new Error(text || `MCP 服务返回 HTTP ${response.status}`)
  return JSON.parse(text)
}

const input = createInterface({ input: process.stdin, crlfDelay: Infinity })
for await (const line of input) {
  if (!line.trim()) continue
  let message
  try {
    message = JSON.parse(line)
  } catch {
    process.stdout.write(`${JSON.stringify(rpcError(null, '输入不是有效的 JSON'))}\n`)
    continue
  }

  try {
    const response = await forward(message)
    if (response !== null) process.stdout.write(`${JSON.stringify(response)}\n`)
  } catch (error) {
    if (message && Object.prototype.hasOwnProperty.call(message, 'id')) {
      process.stdout.write(`${JSON.stringify(rpcError(message.id, error instanceof Error ? error.message : String(error)))}\n`)
    } else {
      process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    }
  }
}
