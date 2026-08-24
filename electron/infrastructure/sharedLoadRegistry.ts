interface SharedLoadOptions<Progress> {
  signal?: AbortSignal
  onProgress?: (progress: Progress) => void
}

interface Subscriber<Value, Progress> {
  active: boolean
  onProgress?: (progress: Progress) => void
  resolve: (value: Value) => void
  reject: (error: unknown) => void
}

interface PendingLoad<Value, Progress> {
  controller: AbortController
  promise: Promise<Value>
  subscribers: Set<Subscriber<Value, Progress>>
  latestProgress?: Progress
  settled: boolean
}

function abortError(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('操作已取消', 'AbortError')
}

function notifyProgress<Value, Progress>(subscriber: Subscriber<Value, Progress>, progress: Progress): void {
  try {
    subscriber.onProgress?.(progress)
  } catch {
    // Observers must not be able to fail the shared model load.
  }
}

export class SharedLoadRegistry<Key, Value, Progress> {
  private readonly pending = new Map<Key, PendingLoad<Value, Progress>>()

  load(
    key: Key,
    start: (signal: AbortSignal, reportProgress: (progress: Progress) => void) => Promise<Value>,
    options: SharedLoadOptions<Progress> = {},
  ): Promise<Value> {
    if (options.signal?.aborted) return Promise.reject(abortError(options.signal))
    let pending = this.pending.get(key)
    if (!pending) {
      const controller = new AbortController()
      pending = {
        controller,
        promise: Promise.resolve(undefined as Value),
        subscribers: new Set(),
        settled: false,
      }
      const created = pending
      created.promise = Promise.resolve().then(() => start(controller.signal, (progress) => {
        created.latestProgress = progress
        for (const subscriber of created.subscribers) notifyProgress(subscriber, progress)
      }))
      this.pending.set(key, created)
      void created.promise.then(
        () => this.finish(key, created),
        () => this.finish(key, created),
      )
      pending = created
    }
    return this.subscribe(key, pending, options)
  }

  private finish(key: Key, pending: PendingLoad<Value, Progress>): void {
    pending.settled = true
    if (this.pending.get(key) === pending) this.pending.delete(key)
  }

  private subscribe(
    key: Key,
    pending: PendingLoad<Value, Progress>,
    options: SharedLoadOptions<Progress>,
  ): Promise<Value> {
    const { signal, onProgress } = options
    if (signal?.aborted) return Promise.reject(abortError(signal))

    return new Promise<Value>((resolve, reject) => {
      const subscriber: Subscriber<Value, Progress> = { active: true, onProgress, resolve, reject }
      const cleanup = (): void => {
        if (!subscriber.active) return
        subscriber.active = false
        pending.subscribers.delete(subscriber)
        signal?.removeEventListener('abort', handleAbort)
      }
      const handleAbort = (): void => {
        if (!subscriber.active) return
        cleanup()
        reject(signal ? abortError(signal) : new DOMException('操作已取消', 'AbortError'))
        if (!pending.settled && pending.subscribers.size === 0) {
          if (this.pending.get(key) === pending) this.pending.delete(key)
          pending.controller.abort()
        }
      }

      pending.subscribers.add(subscriber)
      signal?.addEventListener('abort', handleAbort, { once: true })
      if (pending.latestProgress !== undefined) notifyProgress(subscriber, pending.latestProgress as Progress)
      if (signal?.aborted) handleAbort()
      void pending.promise.then(
        (value) => {
          if (!subscriber.active) return
          cleanup()
          resolve(value)
        },
        (error) => {
          if (!subscriber.active) return
          cleanup()
          reject(error)
        },
      )
    })
  }
}
