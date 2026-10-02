import type { ExternalAgentAdapter } from './adapter'
import type { ExternalAgentTaskRequest, ExternalAgentTaskResult } from '../../../src/shared/types/externalAgent'

export function createExternalAgentService(
  adapters: ExternalAgentAdapter[],
  host: { openExternal(url: string): Promise<void>; copyText(text: string): void },
) {
  const registry = new Map<string, ExternalAgentAdapter>()
  for (const adapter of adapters) {
    if (registry.has(adapter.descriptor.id)) throw new Error('重复的 Agent')
    if (adapter.descriptor.capabilities.open !== Boolean(adapter.open)
      || adapter.descriptor.capabilities.download !== Boolean(adapter.downloadUrl)
      || adapter.descriptor.capabilities.skillInstallation !== Boolean(adapter.installSkill)
      || (adapter.descriptor.capabilities.task === 'draft') !== Boolean(adapter.startTask)) {
      throw new Error('Agent 能力配置不一致')
    }
    registry.set(adapter.descriptor.id, adapter)
  }
  const resolve = (id: string) => {
    const adapter = registry.get(id)
    if (!adapter) throw new Error('不支持此 Agent')
    return adapter
  }
  return {
    list: () => adapters.map(adapter => adapter.descriptor),
    isInstalled: (id: string) => resolve(id).isInstalled(),
    open: async (id: string) => {
      const adapter = resolve(id)
      if (!adapter.open) throw new Error('此 Agent 暂不支持打开')
      await adapter.open()
    },
    download: async (id: string) => {
      const adapter = resolve(id)
      if (!adapter.downloadUrl) throw new Error('此 Agent 暂不支持下载')
      await host.openExternal(adapter.downloadUrl)
    },
    installSkill: async (id: string) => {
      const adapter = resolve(id)
      if (!adapter.installSkill) throw new Error('此 Agent 暂不支持安装技能')
      await adapter.installSkill()
    },
    startTask: async (id: string, request: ExternalAgentTaskRequest): Promise<ExternalAgentTaskResult> => {
      const adapter = resolve(id)
      if (!request || typeof request.prompt !== 'string' || !request.prompt.trim() || request.prompt.length > 100_000) {
        throw new Error('请输入有效的任务要求')
      }
      if (!await adapter.isInstalled()) throw new Error(`未检测到 ${adapter.descriptor.name}`)
      if (adapter.startTask) return adapter.startTask(request)
      if (adapter.descriptor.capabilities.task !== 'clipboard' || !adapter.open) {
        throw new Error('此 Agent 暂不支持发起会话')
      }
      await adapter.open()
      host.copyText(request.prompt)
      return { mode: 'clipboard' }
    },
  }
}
