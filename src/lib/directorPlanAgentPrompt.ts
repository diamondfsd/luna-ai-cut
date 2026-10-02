import { agentDiscoveryPrompt } from './agentDiscoveryPrompt.ts'
import type { AiEditorHttpConnection } from '../shared/types'

export function buildDirectorPlanAgentPrompt(connection: AiEditorHttpConnection, userRequest: string): string {
  return `请通过本机正在运行的 Luna AI Cut 创建导演计划。
${agentDiscoveryPrompt(connection, 'director-plan')}
所有工具、参数和操作流程以该指引和实时工具清单为准。使用本地 HTTP 工具，不要直接读写项目文件，也不需要安装 Skill 或配置 MCP。
读取导演计划格式，领取 Luna 已创建的导演计划任务会话，确认 purpose=director-plan，创建并校验导演计划，保存到 Luna 后读取确认并通过任务工具报告结果。任务仅创建导演计划，不创建剪辑项目或导出视频。

用户原始要求：
${userRequest.trim()}`
}
