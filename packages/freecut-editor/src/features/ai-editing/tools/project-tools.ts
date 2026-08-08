import { z } from 'zod'
import { buildProjectEvidence } from '../evidence'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const inspectProject = defineAiEditingTool({
  id: 'project.inspect',
  title: '查看剪辑内容',
  description: '读取时间轴和已分析素材的结构化摘要。不会读取或发送原始视频画面。',
  risk: 'read',
  inputSchema: objectSchema({}),
  schema: z.object({}),
  summarize: () => '查看当前项目',
  execute: async () => ({ ok: true, message: '已读取项目摘要。', data: await buildProjectEvidence() }),
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [inspectProject],
}
