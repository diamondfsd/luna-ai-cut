import { z } from 'zod'
import { listAiEditingSkills, readAiEditingSkill, searchAiEditingSkills } from '../skills/service'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const searchSkills = defineAiEditingTool({
  id: 'skill.search',
  title: '查找专业技能',
  description: '按当前创作目标查找可选的专业知识。技能只提供判断原则和质量标准，不会自动执行固定流程。',
  risk: 'read',
  inputSchema: objectSchema({
    query: { type: 'string', description: '当前创作目标、内容类型或希望获得的专业能力。' },
  }, ['query']),
  schema: z.object({ query: z.string().min(1).max(300) }),
  summarize: (args) => `查找“${args.query}”相关的专业技能`,
  execute: async (args) => {
    const matches = searchAiEditingSkills(args.query, await listAiEditingSkills()).slice(0, 8)
    return {
      ok: true,
      message: matches.length > 0 ? `找到 ${matches.length} 项可参考的专业技能。` : '没有找到匹配的专业技能。',
      data: {
        skills: matches.map((skill) => ({ id: skill.id, name: skill.name, description: skill.description })),
      },
    }
  },
})

const readSkill = defineAiEditingTool({
  id: 'skill.read',
  title: '读取专业技能',
  description: '读取一项技能的专业判断原则、约束、可用能力和质量标准，由 Agent 结合当前工程自主采用。',
  risk: 'read',
  inputSchema: objectSchema({
    skillId: { type: 'string', description: 'skill.search 返回的技能 ID。' },
  }, ['skillId']),
  schema: z.object({ skillId: z.string().min(1).max(80) }),
  summarize: (args) => `读取专业技能 ${args.skillId}`,
  execute: async (args) => {
    const skill = await readAiEditingSkill(args.skillId)
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
  createTools: () => [searchSkills, readSkill],
}
