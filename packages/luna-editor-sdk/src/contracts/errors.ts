export type LunaErrorCode =
  | "ABORTED"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "HTTP_ERROR"
  | "INVALID_REQUEST"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "REVISION_CONFLICT"
  | "VALIDATION_ERROR"
  | "MEDIA_MISSING"
  | "RENDER_FAILED"
  | "JOB_INTERRUPTED"
  | "RESOURCE_BUSY"
  | "RATE_LIMITED"
  | "UNSUPPORTED"
  | "CAPABILITY_UNAVAILABLE"
  | "JOB_FAILED"
  | "PROTOCOL_ERROR"
  | "UNKNOWN"

export interface LunaErrorDetails {
  readonly code: LunaErrorCode
  readonly message: string
  readonly details?: unknown
  readonly retryable?: boolean
}

export class LunaError extends Error {
  readonly code: LunaErrorCode
  readonly details?: unknown
  readonly retryable: boolean

  constructor(error: LunaErrorDetails) {
    super(error.message)
    this.name = "LunaError"
    this.code = error.code
    this.details = error.details
    this.retryable = error.retryable ?? false
  }

  toJSON(): LunaErrorDetails {
    return {
      code: this.code,
      message: this.message,
      details: this.details,
      retryable: this.retryable,
    }
  }
}

export function isLunaError(error: unknown): error is LunaError {
  if (error instanceof LunaError) return true
  if (!error || typeof error !== "object") return false
  const record = error as Record<string, unknown>
  return record.name === "LunaError" && typeof record.code === "string" && isLunaErrorCode(record.code)
}

export function toLunaError(error: unknown, fallbackCode: LunaErrorCode = "UNKNOWN"): LunaError {
  if (isLunaError(error)) {
    return error
  }

  if (typeof DOMException !== "undefined" && error instanceof DOMException && error.name === "AbortError") {
    return new LunaError({ code: "ABORTED", message: "The request was aborted." })
  }

  if (error instanceof Error) {
    return new LunaError({ code: fallbackCode, message: error.message, details: error })
  }

  return new LunaError({ code: fallbackCode, message: "An unknown Luna SDK error occurred.", details: error })
}

export function errorFromDetails(value: unknown): LunaError {
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>
    const code = record.code
    const message = record.message
    if (typeof code === "string" && typeof message === "string") {
      return new LunaError({
        code: isLunaErrorCode(code) ? code : "UNKNOWN",
        message,
        details: record.details,
        retryable: record.retryable === true,
      })
    }
  }

  return new LunaError({ code: "PROTOCOL_ERROR", message: "The host returned an invalid error." })
}

function isLunaErrorCode(value: string): value is LunaErrorCode {
  return [
    "ABORTED",
    "TIMEOUT",
    "NETWORK_ERROR",
    "HTTP_ERROR",
    "INVALID_REQUEST",
    "UNAUTHORIZED",
    "FORBIDDEN",
    "NOT_FOUND",
    "CONFLICT",
    "REVISION_CONFLICT",
    "VALIDATION_ERROR",
    "MEDIA_MISSING",
    "RENDER_FAILED",
    "JOB_INTERRUPTED",
    "RESOURCE_BUSY",
    "RATE_LIMITED",
    "UNSUPPORTED",
    "CAPABILITY_UNAVAILABLE",
    "JOB_FAILED",
    "PROTOCOL_ERROR",
    "UNKNOWN",
  ].includes(value)
}
