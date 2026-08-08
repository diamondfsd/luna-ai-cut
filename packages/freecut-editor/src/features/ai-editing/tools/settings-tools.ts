import { z } from 'zod'
import {
  applyAiSettingChanges,
  getAiEditableSettings,
  listAiEditableSettings,
  validateAiSettingChanges,
} from '../settings-registry'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const inspectSettings = defineAiEditingTool({
  id: 'settings.inspect',
  title: '查看编辑设置',
  description: '读取可由剪辑助手调整的用户设置，不包含账号和密钥。',
  risk: 'read',
  inputSchema: objectSchema({}),
  schema: z.object({}),
  summarize: () => '查看编辑设置',
  execute: () => ({
    ok: true,
    message: '已读取可调整的编辑设置。',
    data: { definitions: listAiEditableSettings(), values: getAiEditableSettings() },
  }),
})

const updateSettings = defineAiEditingTool({
  id: 'settings.update',
  title: '调整编辑设置',
  description: '调整用户可见的编辑设置。应用前会展示变更内容。',
  risk: 'settings',
  inputSchema: objectSchema({
    changes: {
      type: 'array',
      items: {
        type: 'object',
        properties: { key: { type: 'string' }, value: {} },
        required: ['key', 'value'],
      },
    },
  }, ['changes']),
  schema: z.object({ changes: z.array(z.object({ key: z.string(), value: z.unknown() })).min(1) }),
  summarize: (args) => `调整 ${args.changes.length} 项编辑设置`,
  execute: (args) => {
    const validation = validateAiSettingChanges(args.changes)
    if (!validation.ok) return { ok: false, message: validation.error }
    applyAiSettingChanges(validation.changes)
    return { ok: true, message: `已调整 ${validation.changes.length} 项编辑设置。`, data: validation.changes }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [inspectSettings, updateSettings],
}
