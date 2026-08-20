import type { OperationResult, OperationResultInput, RequestOptions } from "../contracts/common.js"
import { errorFromDetails, LunaError, toLunaError } from "../contracts/errors.js"
import {
  LUNA_EDITOR_API_VERSION,
  LUNA_EDITOR_PROTOCOL,
  type LunaTransport,
  type RpcRequest,
} from "./transport.js"

export interface LoopbackHttpTransportOptions {
  readonly endpoint: string
  readonly token?: string
  readonly headers?: Readonly<Record<string, string>>
  readonly fetch?: typeof globalThis.fetch
  readonly defaultTimeoutMs?: number
}

export class LoopbackHttpTransport implements LunaTransport {
  private readonly endpoint: string
  private readonly token?: string
  private readonly headers: Readonly<Record<string, string>>
  private readonly fetchImpl: typeof globalThis.fetch
  private readonly defaultTimeoutMs: number

  constructor(options: LoopbackHttpTransportOptions) {
    if (!options.endpoint) {
      throw new LunaError({ code: "INVALID_REQUEST", message: "A loopback endpoint is required." })
    }

    this.endpoint = options.endpoint
    this.token = options.token
    this.headers = options.headers ?? {}
    if (!options.fetch && typeof globalThis.fetch !== "function") {
      throw new LunaError({ code: "UNSUPPORTED", message: "This runtime does not provide fetch." })
    }
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis)
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 30_000
  }

  async request<TData>(request: RpcRequest, options: RequestOptions = {}): Promise<OperationResult<TData>> {
    const controller = new AbortController()
    const timeoutMs = options.timeoutMs ?? this.defaultTimeoutMs
    let timedOut = false
    let timeoutHandle: ReturnType<typeof setTimeout> | undefined
    const onAbort = (): void => controller.abort()

    if (options.signal?.aborted) {
      controller.abort()
    } else if (options.signal) {
      options.signal.addEventListener("abort", onAbort, { once: true })
    }

    if (timeoutMs > 0) {
      timeoutHandle = setTimeout(() => {
        timedOut = true
        controller.abort()
      }, timeoutMs)
    }

    try {
      const headers: Record<string, string> = {
        Accept: "application/json",
        "Content-Type": "application/json",
        ...this.headers,
      }
      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`
      }

      const { context, ...wireRequest } = request
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          ...wireRequest,
          protocol: LUNA_EDITOR_PROTOCOL,
          apiVersion: LUNA_EDITOR_API_VERSION,
          ...(context ?? {}),
        }),
        signal: controller.signal,
      })

      const text = await response.text()
      const body = parseJson(text)
      if (!response.ok) {
        throw new LunaError({
          code: statusToErrorCode(response.status),
          message: getErrorMessage(body, `The host returned HTTP ${response.status}.`),
          details: body,
          retryable: response.status >= 500,
        })
      }

      return parseSuccess<TData>(body, request.requestId)
    } catch (error) {
      if (error instanceof LunaError) {
        throw error
      }
      if (timedOut) {
        throw new LunaError({ code: "TIMEOUT", message: "The host request timed out.", retryable: true })
      }
      if (options.signal?.aborted) {
        throw new LunaError({ code: "ABORTED", message: "The host request was aborted." })
      }
      throw toLunaError(error, "NETWORK_ERROR")
    } finally {
      if (timeoutHandle) {
        clearTimeout(timeoutHandle)
      }
      options.signal?.removeEventListener("abort", onAbort)
    }
  }
}

function parseJson(text: string): unknown {
  if (!text) {
    throw new LunaError({ code: "PROTOCOL_ERROR", message: "The host returned an empty response." })
  }

  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new LunaError({ code: "PROTOCOL_ERROR", message: "The host returned invalid JSON.", details: error })
  }
}

function parseSuccess<TData>(body: unknown, requestId: string): OperationResult<TData> {
  if (!isRecord(body)) {
    throw new LunaError({ code: "PROTOCOL_ERROR", message: "The host returned an invalid response." })
  }

  validateEnvelope(body, requestId)

  if (body.ok === false) {
    throw errorFromDetails(body.error)
  }

  const candidate = isRecord(body.result) && "data" in body.result ? body.result : undefined
  if (!candidate) {
    throw new LunaError({ code: "PROTOCOL_ERROR", message: "The host returned an invalid result envelope." })
  }
  const data = candidate.data

  const input: OperationResultInput<TData> = {
    data: data as TData,
    operationId: optionalString(candidate.operationId, "operationId") ?? requestId,
    revision: optionalString(candidate.revision, "revision"),
    affectedIds: stringArray(candidate.affectedIds, "affectedIds"),
    createdIds: stringArray(candidate.createdIds, "createdIds"),
    removedIds: stringArray(candidate.removedIds, "removedIds"),
    warnings: stringArray(candidate.warnings, "warnings"),
  }

  return {
    data: input.data,
    operationId: input.operationId ?? requestId,
    revision: input.revision,
    affectedIds: input.affectedIds ?? [],
    createdIds: input.createdIds ?? [],
    removedIds: input.removedIds ?? [],
    warnings: input.warnings ?? [],
  }
}

function validateEnvelope(body: Record<string, unknown>, requestId: string): void {
  if (body.protocol !== LUNA_EDITOR_PROTOCOL || body.apiVersion !== LUNA_EDITOR_API_VERSION) {
    throw new LunaError({ code: "PROTOCOL_ERROR", message: "The host returned an incompatible protocol envelope." })
  }
  if (body.requestId !== requestId) {
    throw new LunaError({ code: "PROTOCOL_ERROR", message: "The host response does not match the request id." })
  }
  if (body.ok !== true && body.ok !== false) {
    throw new LunaError({ code: "PROTOCOL_ERROR", message: "The host response is missing its success flag." })
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== "string") {
    throw new LunaError({ code: "PROTOCOL_ERROR", message: `The host returned an invalid ${field}.` })
  }
  return value
}

function stringArray(value: unknown, field: string): readonly string[] | undefined {
  if (value === undefined) {
    return undefined
  }
  if (!Array.isArray(value)) {
    throw new LunaError({ code: "PROTOCOL_ERROR", message: `The host returned an invalid ${field}.` })
  }
  if (!value.every((item): item is string => typeof item === "string")) {
    throw new LunaError({ code: "PROTOCOL_ERROR", message: `The host returned an invalid ${field}.` })
  }
  return value
}

function getErrorMessage(body: unknown, fallback: string): string {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.message === "string") {
    return body.error.message
  }
  return fallback
}

function statusToErrorCode(
  status: number,
): "UNAUTHORIZED" | "FORBIDDEN" | "NOT_FOUND" | "CONFLICT" | "TIMEOUT" | "RATE_LIMITED" | "HTTP_ERROR" {
  if (status === 401) return "UNAUTHORIZED"
  if (status === 403) return "FORBIDDEN"
  if (status === 404) return "NOT_FOUND"
  if (status === 409) return "CONFLICT"
  if (status === 408) return "TIMEOUT"
  if (status === 429) return "RATE_LIMITED"
  return "HTTP_ERROR"
}
