import { z } from 'zod'
import { applyEditProgram } from '../edit-program/apply-edit-program'
import { editProgramSchema, editProgramToolInputSchema } from '../edit-program/schema'
import type { EditProgram } from '../edit-program/types'
import type { AiEditingToolModule } from '../types'
import { defineAiEditingTool } from './tool-utils'

const applyWorkspaceEditProgram = defineAiEditingTool({
  id: 'workspace.apply_edit_program',
  title: '应用编辑程序',
  description: '校验并原子执行一份声明式编辑程序，返回实际片段差异、警告和最新版本。',
  risk: 'edit',
  execution: 'async',
  inputSchema: editProgramToolInputSchema,
  schema: z.object({ program: editProgramSchema }),
  summarize: (args) => `执行编辑程序：${args.program.intent}`,
  execute: async ({ program }, context) => {
    context?.signal?.throwIfAborted()
    context?.reportProgress({ label: '正在校验剪辑方案', percent: 10 })
    const result = await applyEditProgram(program as EditProgram)
    context?.reportProgress({ label: '正在保存剪辑结果', percent: 90 })
    return {
      ok: true,
      message: result.committed ? '编辑程序已完整应用。' : '编辑程序预演通过，尚未修改时间轴。',
      data: result,
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [applyWorkspaceEditProgram],
}
