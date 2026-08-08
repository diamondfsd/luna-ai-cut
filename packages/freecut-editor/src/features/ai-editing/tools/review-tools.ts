import { z } from 'zod'
import { buildProjectEvidence } from '../evidence'
import { validateFinishedVideo } from '../production-skill'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool, objectSchema } from './tool-utils'

const reviewFinishedVideo = defineAiEditingTool({
  id: 'review.finished_video',
  title: '复核成片完整性',
  description: '重新读取时间轴，检查画面覆盖、可观看时长和基本叙事完整性。用于辅助判断，不能替代 Agent 对用户目标的复核。',
  risk: 'read',
  inputSchema: objectSchema({}),
  schema: z.object({}),
  summarize: () => '复核当前成片',
  execute: async () => {
    const review = validateFinishedVideo(await buildProjectEvidence())
    return {
      ok: review.passed,
      message: review.passed ? '当前时间轴通过成片完整性检查。' : review.reasons.join(''),
      data: review,
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [reviewFinishedVideo],
}
