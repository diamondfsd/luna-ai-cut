import type { AiEditorHttpConnection } from '../shared/types'
import { agentDiscoveryPrompt } from './agentDiscoveryPrompt.ts'

/** No domain selection here: live tools provide skills, workflows and task guidance. */
export function buildAssistantAgentPrompt(connection: AiEditorHttpConnection, userRequest: string): string {
  return `请根据用户要求使用 Luna AI Cut。
${agentDiscoveryPrompt(connection)}
按工具返回的公共指引领取并核对交接任务，阅读适用技能后执行。不要求用户在 Luna 选择功能；需求不明确时在当前 Agent 对话中澄清。
后续沟通在本 Agent 中进行，Luna 展示任务进度和结果。使用发现的任务工具报告结果，不读取项目文件代替工具调用。

用户原始要求：
${userRequest}`
}
