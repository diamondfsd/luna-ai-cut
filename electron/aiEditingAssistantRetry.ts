export const AI_EDITING_ASSISTANT_MAX_ATTEMPTS = 3
export const AI_EDITING_ASSISTANT_ATTEMPT_TIMEOUT_MS = 4 * 60 * 1_000
export const AI_EDITING_ASSISTANT_RETRY_DELAY_MS = 1_000

export class AiEditingAssistantAttemptTimeoutError extends Error {
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`AI editing assistant request timed out after ${timeoutMs}ms`)
    this.name = 'AiEditingAssistantAttemptTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

interface RetryOptions<T> {
  execute: (signal: AbortSignal, attempt: number, reportActivity: () => void) => Promise<T>
  signal: AbortSignal
  shouldRetry: (error: unknown) => boolean
  onRetry?: (error: unknown, attempt: number, nextAttempt: number) => void
  maxAttempts?: number
  attemptTimeoutMs?: number
  retryDelayMs?: number
}

function abortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Aborted', 'AbortError')
}

function waitForRetry(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortReason(signal))
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort)
      resolve()
    }, delayMs)
    const onAbort = (): void => {
      clearTimeout(timer)
      signal.removeEventListener('abort', onAbort)
      reject(abortReason(signal))
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}

export async function runAiEditingAssistantRequestWithRetry<T>(options: RetryOptions<T>): Promise<T> {
  const maxAttempts = options.maxAttempts ?? AI_EDITING_ASSISTANT_MAX_ATTEMPTS
  const attemptTimeoutMs = options.attemptTimeoutMs ?? AI_EDITING_ASSISTANT_ATTEMPT_TIMEOUT_MS
  const retryDelayMs = options.retryDelayMs ?? AI_EDITING_ASSISTANT_RETRY_DELAY_MS
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1) throw new Error('maxAttempts must be at least 1')
  if (!Number.isFinite(attemptTimeoutMs) || attemptTimeoutMs <= 0) throw new Error('attemptTimeoutMs must be positive')
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) throw new Error('retryDelayMs cannot be negative')

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (options.signal.aborted) throw abortReason(options.signal)

    const attemptController = new AbortController()
    let timedOut = false
    const cancelAttempt = (): void => attemptController.abort(abortReason(options.signal))
    options.signal.addEventListener('abort', cancelAttempt, { once: true })
    let timeout: ReturnType<typeof setTimeout>
    const startTimeout = (): void => {
      clearTimeout(timeout)
      timeout = setTimeout(() => {
        timedOut = true
        attemptController.abort(new AiEditingAssistantAttemptTimeoutError(attemptTimeoutMs))
      }, attemptTimeoutMs)
    }
    startTimeout()
    const cleanupAttempt = (): void => {
      clearTimeout(timeout)
      options.signal.removeEventListener('abort', cancelAttempt)
    }

    try {
      return await options.execute(attemptController.signal, attempt, startTimeout)
    } catch (caught) {
      cleanupAttempt()
      if (options.signal.aborted) throw abortReason(options.signal)
      const error = timedOut
        ? new AiEditingAssistantAttemptTimeoutError(attemptTimeoutMs)
        : caught
      if (attempt === maxAttempts || !options.shouldRetry(error)) throw error

      const nextAttempt = attempt + 1
      options.onRetry?.(error, attempt, nextAttempt)
      await waitForRetry(retryDelayMs * 2 ** (attempt - 1), options.signal)
    } finally {
      cleanupAttempt()
    }
  }

  throw new Error('AI editing assistant retry loop ended unexpectedly')
}
