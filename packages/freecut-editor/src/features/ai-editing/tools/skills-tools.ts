import { z } from 'zod'
import { readAiEditingSkill } from '../skills/service'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const readSkill = defineAiEditingTool({
  id: 'skill.read',
  title: '读取专业技能',
  description: '按初始技能清单中的名称读取一项技能的完整说明。只在当前任务与该技能描述匹配时调用。',
  risk: 'read',
  inputSchema: objectSchema({
    name: { type: 'string', description: '初始系统上下文中列出的技能名称。' },
  }, ['name']),
  schema: z.object({ name: z.string().min(1).max(120) }),
  summarize: (args) => `读取专业技能 ${args.name}`,
  execute: async (args) => {
    const skill = await readAiEditingSkill(args.name)
    if (!skill) return { ok: false, message: '没有找到这项已启用的专业技能。' }
    return {
      ok: true,
      message: `已读取“${skill.name}”的专业知识，请根据当前工程自主决定如何使用。`,
      data: {
        skill: {
          id: skill.id,
          name: skill.name,
          description: skill.description,
          guidance: skill.instructions,
          requiresFinishedVideo: skill.requiresFinishedVideo,
        },
        tools: skill.toolIds.map((id) => ({ id })),
      },
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [readSkill],
}
