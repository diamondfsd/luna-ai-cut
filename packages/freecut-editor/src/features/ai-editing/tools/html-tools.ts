import { useTimelineStore } from '@freecut/features/editor/deps/timeline-store'
import { z } from 'zod'
import { hashHtmlSource, validateHtmlSource } from '../edit-program/html-source'
import type { AiEditingToolModule } from '../types'
import { idFromAgentRef } from '../workspace-document/build-workspace-document'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const viewportSchema = z.object({
  width: z.number().int().min(1).max(8192),
  height: z.number().int().min(1).max(8192),
  deviceScaleFactor: z.number().finite().min(0.25).max(4),
})

const validateHtml = defineAiEditingTool({
  id: 'html.validate',
  title: '检查 HTML/CSS',
  description: '在写入时间轴前检查 HTML/CSS 源码、视口和不可执行的主动内容；不会限制正常 CSS 布局和视觉能力。',
  risk: 'analysis',
  inputSchema: objectSchema({
    html: { type: 'string', description: '完整 HTML 标记。' },
    css: { type: 'string', description: '完整 CSS 样式。' },
    viewport: {
      type: 'object',
      description: '可选的固定渲染视口。',
      properties: {
        width: { type: 'integer', minimum: 1, maximum: 8192 },
        height: { type: 'integer', minimum: 1, maximum: 8192 },
        deviceScaleFactor: { type: 'number', minimum: 0.25, maximum: 4 },
      },
      required: ['width', 'height', 'deviceScaleFactor'],
      additionalProperties: false,
    },
  }, ['html', 'css']),
  schema: z.object({
    html: z.string().min(1).max(500_000),
    css: z.string().max(500_000),
    viewport: viewportSchema.optional(),
  }),
  summarize: () => '检查 HTML/CSS 源码',
  execute: (args) => {
    const validation = validateHtmlSource(args)
    return {
      ok: validation.valid,
      message: validation.valid ? 'HTML/CSS 源码可以写入时间轴。' : validation.errors[0] ?? 'HTML/CSS 源码无法使用。',
      data: validation,
    }
  },
})

const readHtml = defineAiEditingTool({
  id: 'html.read',
  title: '读取 HTML 源码',
  description: '按 workspace 中的 HTML 片段引用读取完整 HTML/CSS 源码；workspace 本身只保留摘要和哈希。',
  risk: 'read',
  inputSchema: objectSchema({
    clipRef: { type: 'string', description: 'workspace.clips[].ref 中 type=html 的片段引用。' },
  }, ['clipRef']),
  schema: z.object({ clipRef: z.string().startsWith('clip:') }),
  summarize: (args) => `读取 ${args.clipRef} 的 HTML/CSS 源码`,
  execute: async (args) => {
    const itemId = idFromAgentRef(args.clipRef, 'clip')
    const item = useTimelineStore.getState().items.find((candidate) => candidate.id === itemId)
    if (!item) return { ok: false, message: '没有找到这个时间轴片段。' }
    if (item.type !== 'html') return { ok: false, message: '这个片段不是 HTML 视觉。' }
    const htmlItem = item
    return {
      ok: true,
      message: `已读取“${item.label}”的 HTML/CSS 源码。`,
      data: {
        clipRef: args.clipRef,
        hash: await hashHtmlSource(htmlItem.html, htmlItem.css),
        revision: htmlItem.sourceRevision,
        html: htmlItem.html,
        css: htmlItem.css,
        viewport: htmlItem.viewport,
        renderMode: htmlItem.renderMode,
      },
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [validateHtml, readHtml],
}
