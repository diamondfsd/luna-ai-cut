import { appToolRegistry } from './lunaAppToolModules.ts'
import type { LunaMcpServerOptions } from './lunaMcpProtocol.ts'

interface ToolCatalog { tools: unknown[] }

export async function getToolCatalog(options: LunaMcpServerOptions): Promise<ToolCatalog> {
  return { tools: appToolRegistry(options).tools }
}

function toolName(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const name = (value as Record<string, unknown>).name
  return typeof name === 'string' && name.trim() ? name : null
}

export function openApiDocument(baseUrl: string, catalog: ToolCatalog): Record<string, unknown> {
  const paths: Record<string, unknown> = {}
  for (const tool of catalog.tools) {
    const name = toolName(tool)
    if (!name || !tool || typeof tool !== 'object') continue
    const record = tool as Record<string, unknown>
    paths[`/api/tools/${encodeURIComponent(name)}`] = {
      post: {
        operationId: `call_${name}`,
        summary: typeof record.description === 'string' ? record.description : name,
        requestBody: { required: false, content: { 'application/json': { schema: {
          type: 'object', properties: { arguments: record.inputSchema ?? { type: 'object' } }, additionalProperties: true,
        } } } },
        responses: { '200': { description: 'Tool result' } },
      },
    }
  }
  return {
    openapi: '3.1.0',
    info: { title: 'Luna AI Cut Local Agent API', version: '2.0.0', description: 'Local HTTP tool API for Luna AI 导拍与剪辑 workflows.' },
    servers: [{ url: baseUrl }],
    paths,
    'x-luna': { skill: '/skill.md', skillIndex: '/skills/index.md', tools: '/tools' },
  }
}
