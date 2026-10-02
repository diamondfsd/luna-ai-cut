import { randomUUID } from 'node:crypto'
import type { AiEditorMcpResponse } from '../../src/shared/types/aiEditor.ts'
import { asRecord, type LunaMcpServerOptions } from './lunaMcpProtocol.ts'
import { AGENT_TASK_TOOLS } from './lunaMcpTaskCatalog.ts'
import { DIRECTOR_PLAN_TOOLS } from './directorPlanTools.ts'

interface ToolCatalog {
  tools: unknown[]
  editorToolsReady: boolean
  message?: string
}

export async function getToolCatalog(options: LunaMcpServerOptions): Promise<ToolCatalog> {
  const nativeTools = [...AGENT_TASK_TOOLS, ...(options.directorPlanTools ? DIRECTOR_PLAN_TOOLS : [])]
  let bridgeResponse: AiEditorMcpResponse
  try {
    bridgeResponse = await options.requestRenderer({
      callId: randomUUID(),
      kind: 'listTools',
    })
  } catch (error) {
    return {
      tools: nativeTools,
      editorToolsReady: false,
      message: error instanceof Error ? error.message : String(error),
    }
  }
  if (!bridgeResponse.ok) {
    return {
      tools: nativeTools,
      editorToolsReady: false,
      message: bridgeResponse.error ?? 'AI 剪辑页面尚未加载，请领取任务后激活 Luna 并重新获取工具清单',
    }
  }
  const rendererTools = Array.isArray(bridgeResponse.result) ? bridgeResponse.result : []
  return {
    tools: [...nativeTools, ...rendererTools],
    editorToolsReady: rendererTools.length > 0,
  }
}

function toolName(value: unknown): string | null {
  const record = asRecord(value)
  return typeof record?.name === 'string' && record.name.trim() ? record.name : null
}

export function openApiDocument(baseUrl: string, catalog: ToolCatalog): Record<string, unknown> {
  const paths: Record<string, unknown> = {}
  for (const tool of catalog.tools) {
    const record = asRecord(tool)
    const name = toolName(tool)
    if (!record || !name) continue
    paths[`/api/tools/${encodeURIComponent(name)}`] = {
      post: {
        operationId: `call_${name}`,
        summary: typeof record.description === 'string' ? record.description : name,
        requestBody: {
          required: false,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                properties: {
                  arguments: record.inputSchema ?? { type: 'object' },
                },
                additionalProperties: true,
              },
            },
          },
        },
        responses: {
          '200': { description: 'Tool result' },
        },
      },
    }
  }
  return {
    openapi: '3.1.0',
    info: {
      title: 'Luna AI Cut Local Agent API',
      version: '1.0.0',
      description: 'Local HTTP tool API for controlling the Luna AI Cut desktop editor.',
    },
    servers: [{ url: baseUrl }],
    paths,
    'x-luna': {
      skill: '/skill.md',
      tools: '/tools',
      editorToolsReady: catalog.editorToolsReady,
      ...(catalog.message ? { message: catalog.message } : {}),
    },
  }
}
