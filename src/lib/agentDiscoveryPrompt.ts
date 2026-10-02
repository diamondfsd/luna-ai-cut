import type { AiEditorHttpConnection } from '../shared/types'

/** Bootstrap only: the service tools own the current skill catalog and instructions. */
export function agentDiscoveryPrompt(connection: AiEditorHttpConnection): string {
  return `先读取本机服务发现文件：${connection.discoveryPath ? JSON.stringify(connection.discoveryPath) : '~/.luna-ai-cut/mcp-endpoint.json'}。
从文件获取最新 baseUrl，访问 /.well-known/agent，使用返回的 tools 地址获取工具清单与参数格式，通过返回的 openapi 地址了解调用方式。
根据工具说明找到技能清单查询工具，获取当前技能及公共指引，根据用户需求和技能 description 自主选择，再调用技能全文读取工具；技能编号、处理流程和后续操作以工具实际返回为准，不猜测或预设。
当前服务地址仅作本次参考：${connection.baseUrl}。端口可能变化，不要永久记住当前端口。
每次新任务、应用重启或连接失败时重新读发现文件并确认 /.well-known/agent；无法连接时停止并提示用户启动 Luna，不要扫描端口或修改发现文件。`
}
