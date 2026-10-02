export async function reportEvidenceResult<T>(
  task: Promise<T>, apply: (value: T) => void | Promise<void>, fail: (error: unknown) => void,
  report: () => void, signal?: AbortSignal,
): Promise<void> {
  let result: T
  try {
    result = await task
  } catch (error) {
    signal?.throwIfAborted()
    fail(error)
    report()
    return
  }
  signal?.throwIfAborted()
  await apply(result)
  signal?.throwIfAborted()
  report()
}
