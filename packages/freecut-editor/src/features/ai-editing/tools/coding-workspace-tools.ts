import type { Project } from '@freecut/types/project'
import { z } from 'zod'
import { getTimelineCodingSession } from '../coding-workspace/session-registry'
import { summarizeTimelineProgram } from '../coding-workspace/timeline-session'
import type { AiEditingToolModule } from '../types'
import { executeWorkspaceCommand } from '../workspace-command'
import { defineAiEditingTool, objectSchema } from './tool-utils'

function summarizeBuild(artifact: Project) {
  return {
    projectId: artifact.id,
    projectName: artifact.name,
    ...summarizeTimelineProgram(artifact),
  }
}

const executeCommand = defineAiEditingTool({
  id: 'workspace.exec',
  title: '执行工作区查询命令',
  description: '在当前剪辑工作区执行受限只读命令。支持 ls、rg、sed、wc，以及 git status/diff/log/branch；不支持写文件或运行宿主脚本。',
  risk: 'read',
  execution: 'async',
  inputSchema: objectSchema(
    {
      argv: {
        type: 'array',
        minItems: 1,
        maxItems: 20,
        items: { type: 'string', minLength: 1, maxLength: 512 },
        description: '结构化命令参数，例如 ["rg","-n","mediaId","sequences"]。',
      },
    },
    ['argv'],
  ),
  schema: z.strictObject({
    argv: z.array(z.string().min(1).max(512)).min(1).max(20),
  }),
  summarize: ({ argv }) => argv.join(' '),
  execute: async ({ argv }) => ({
    ok: true,
    message: '工作区命令执行完成。',
    data: await executeWorkspaceCommand(argv),
  }),
})

const gitCommit = defineAiEditingTool({
  id: 'git.commit',
  title: '提交剪辑源码',
  description: '检查当前工程并把模块化剪辑源码提交到 Git 历史，作为本轮编辑的完成检查点。',
  risk: 'edit',
  execution: 'async',
  inputSchema: objectSchema({ message: { type: 'string', minLength: 1, maxLength: 200 } }, [
    'message',
  ]),
  schema: z.strictObject({ message: z.string().trim().min(1).max(200) }),
  summarize: ({ message }) => `提交源码：${message}`,
  execute: async ({ message }) => ({
    ok: true,
    message: '剪辑源码已提交。',
    data: await getTimelineCodingSession().commitSource(message),
  }),
})

const checkTimeline = defineAiEditingTool({
  id: 'timeline.check',
  title: '检查剪辑源码',
  description: '完整解析工程源码和引用，返回编译错误或项目摘要。',
  risk: 'read',
  execution: 'async',
  inputSchema: objectSchema({}),
  schema: z.strictObject({}),
  summarize: () => '检查剪辑源码',
  execute: async () => {
    const result = await getTimelineCodingSession().check()
    const ok = !result.diagnostics.some((diagnostic) => diagnostic.severity === 'error')
    return {
      ok,
      message: ok ? '剪辑源码检查通过。' : '剪辑源码需要修正。',
      data: {
        diagnostics: result.diagnostics,
        ...(result.artifact ? { project: summarizeBuild(result.artifact) } : {}),
      },
    }
  },
})

export const aiEditingToolModule: AiEditingToolModule = {
  createTools: () => [executeCommand, gitCommit, checkTimeline],
}
