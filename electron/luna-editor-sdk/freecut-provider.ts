import type { DeepSeekHarnessToolDefinition } from '../../src/shared/types'
import {
  LunaEditorSdkError,
  type LunaEditorSdkContext,
  type LunaEditorSdkProvider,
  type LunaEditorSdkRequest,
} from './contracts'

export const FREECUT_PROVIDER_ID = 'freecut' as const

/** Namespaces kept compatible with the existing Luna script SDK. */
export const FREECUT_PROVIDER_NAMESPACES = [
  'memory',
  'media',
  'audio',
  'project',
  'timeline',
  'preview',
  'render',
  'ai',
  'jobs',
  'capabilities',
] as const

export interface FreecutProviderAdapter {
  getTools?(context: LunaEditorSdkContext): DeepSeekHarnessToolDefinition[]
  execute(request: LunaEditorSdkRequest, context: LunaEditorSdkContext): Promise<unknown>
}

export type FreecutEditorProvider = LunaEditorSdkProvider & {
  readonly id: typeof FREECUT_PROVIDER_ID
  readonly namespaces: typeof FREECUT_PROVIDER_NAMESPACES
}

export function createFreecutProvider(adapter: FreecutProviderAdapter): FreecutEditorProvider {
  return {
    id: FREECUT_PROVIDER_ID,
    namespaces: FREECUT_PROVIDER_NAMESPACES,
    getTools: (context) => adapter.getTools?.(context) ?? [],
    execute: (request, context) => adapter.execute(request, context),
  }
}

export function createUnboundFreecutProvider(): FreecutEditorProvider {
  return createFreecutProvider({
    execute: async (request) => {
      throw new LunaEditorSdkError(
        'CAPABILITY_UNAVAILABLE',
        `FreeCut Provider 尚未绑定编辑器运行时：${request.name}`,
        { providerId: FREECUT_PROVIDER_ID, capability: request.name },
      )
    },
  })
}
