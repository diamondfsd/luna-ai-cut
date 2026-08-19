import type {
  DeepSeekHarnessContext,
  DeepSeekHarnessToolDefinition,
  DeepSeekHarnessToolRequest,
} from '../../src/shared/types'

export const LUNA_EDITOR_SDK_API_VERSION = 1 as const

export interface LunaEditorSdkContext extends DeepSeekHarnessContext {
  readonly apiVersion: typeof LUNA_EDITOR_SDK_API_VERSION
  readonly requestId: string
  readonly signal: AbortSignal
}

export interface LunaEditorSdkRequest extends DeepSeekHarnessToolRequest {
  readonly args: Record<string, unknown>
}

export interface LunaEditorSdkProvider {
  readonly id: string
  readonly namespaces: readonly string[]
  getTools(context: LunaEditorSdkContext): DeepSeekHarnessToolDefinition[]
  execute(
    request: LunaEditorSdkRequest,
    context: LunaEditorSdkContext,
  ): Promise<unknown>
}

export interface LunaEditorSdkDispatchResult {
  readonly apiVersion: typeof LUNA_EDITOR_SDK_API_VERSION
  readonly providerId: string
  readonly capability: string
  readonly requestId: string
  readonly result: unknown
}

export type LunaEditorSdkErrorCode =
  | 'INVALID_PROVIDER'
  | 'INVALID_CAPABILITY'
  | 'CAPABILITY_UNAVAILABLE'
  | 'ABORTED'
  | 'TIMEOUT'
  | 'WINDOW_UNAVAILABLE'
  | 'IPC_ERROR'

export class LunaEditorSdkError extends Error {
  readonly code: LunaEditorSdkErrorCode
  readonly details?: unknown

  constructor(code: LunaEditorSdkErrorCode, message: string, details?: unknown) {
    super(message)
    this.name = 'LunaEditorSdkError'
    this.code = code
    this.details = details
  }
}
