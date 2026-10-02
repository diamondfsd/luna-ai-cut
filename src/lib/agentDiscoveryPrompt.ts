import type { AiEditorHttpConnection } from '../shared/types'

export function agentDiscoveryPrompt(connection: AiEditorHttpConnection, purpose: 'editing' | 'director-plan'): string {
  const path = purpose === 'director-plan' ? '/skills/director-plan.md' : '/skill.md'
  return `先读取本机服务发现文件：${connection.discoveryPath ? JSON.stringify(connection.discoveryPath) : '~/.luna-ai-cut/mcp-endpoint.json'}。
从该文件获取最新 baseUrl，再完整读取 baseUrl + "${path}" 的实时指引。端口可能变化，不要永久记住当前端口。
当前指引地址仅作本次参考：${connection.baseUrl}${path}。
每次新任务、应用重启或连接失败时重新读发现文件并确认 /.well-known/agent；无法连接时停止并提示用户启动 Luna，不要扫描端口或修改发现文件。`
}
