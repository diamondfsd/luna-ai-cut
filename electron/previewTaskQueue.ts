interface PreviewTask {
  priority: number
  run: () => Promise<unknown>
  resolve: (value: unknown) => void
  reject: (reason?: unknown) => void
}

export function createPreviewTaskQueue(concurrency: number) {
  let activeTasks = 0
  const queue: PreviewTask[] = []

  function drain(): void {
    while (activeTasks < concurrency && queue.length > 0) {
      queue.sort((a, b) => b.priority - a.priority)
      const task = queue.shift()
      if (!task) return

      activeTasks += 1
      task.run()
        .then(task.resolve)
        .catch(task.reject)
        .finally(() => {
          activeTasks -= 1
          drain()
        })
    }
  }

  return function enqueue<T>(run: () => Promise<T>, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      queue.push({
        priority,
        run,
        resolve: (value) => resolve(value as T),
        reject,
      })
      drain()
    })
  }
}
