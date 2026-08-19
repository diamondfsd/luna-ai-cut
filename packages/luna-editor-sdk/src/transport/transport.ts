import type { OperationResult, RequestContext, RequestOptions } from "../contracts/common.js"

export const LUNA_EDITOR_PROTOCOL = "luna.editor" as const
export const LUNA_EDITOR_API_VERSION = 1 as const

export interface RpcRequest<TParams = unknown> {
  readonly protocol: typeof LUNA_EDITOR_PROTOCOL
  readonly apiVersion: typeof LUNA_EDITOR_API_VERSION
  readonly requestId: string
  readonly name: string
  readonly args: TParams
  readonly context?: RequestContext
}

export interface RpcSuccessEnvelope<TData = unknown> {
  readonly protocol: typeof LUNA_EDITOR_PROTOCOL
  readonly apiVersion: typeof LUNA_EDITOR_API_VERSION
  readonly requestId: string
  readonly ok: true
  readonly result: {
    readonly data: TData
    readonly operationId?: string
    readonly revision?: string
    readonly affectedIds?: readonly string[]
    readonly createdIds?: readonly string[]
    readonly removedIds?: readonly string[]
    readonly warnings?: readonly string[]
  }
}

export interface RpcErrorEnvelope {
  readonly protocol: typeof LUNA_EDITOR_PROTOCOL
  readonly apiVersion: typeof LUNA_EDITOR_API_VERSION
  readonly requestId: string
  readonly ok: false
  readonly error: unknown
}

export type RpcResponse<TData = unknown> = RpcSuccessEnvelope<TData> | RpcErrorEnvelope

export interface LunaTransport {
  request<TData>(request: RpcRequest, options?: RequestOptions): Promise<OperationResult<TData>>
  close?(): void
}
