export interface SegmentationTask {
  ownerId: number
  requestId: string
  controller: AbortController
}

export class SegmentationTaskRegistry {
  private readonly tasks = new Map<number, Map<string, SegmentationTask>>()

  begin(ownerId: number, requestId: string): SegmentationTask {
    let ownerTasks = this.tasks.get(ownerId)
    if (!ownerTasks) {
      ownerTasks = new Map()
      this.tasks.set(ownerId, ownerTasks)
    }
    if (ownerTasks.has(requestId)) throw new Error('自动选择任务标识重复')
    const task = { ownerId, requestId, controller: new AbortController() }
    ownerTasks.set(requestId, task)
    return task
  }

  isActive(task: SegmentationTask): boolean {
    return this.tasks.get(task.ownerId)?.get(task.requestId) === task && !task.controller.signal.aborted
  }

  finish(task: SegmentationTask): void {
    const ownerTasks = this.tasks.get(task.ownerId)
    if (ownerTasks?.get(task.requestId) !== task) return
    ownerTasks.delete(task.requestId)
    if (ownerTasks.size === 0) this.tasks.delete(task.ownerId)
  }

  cancel(ownerId: number, requestId: string): boolean {
    const task = this.tasks.get(ownerId)?.get(requestId)
    if (!task) return false
    this.finish(task)
    task.controller.abort()
    return true
  }

  cancelOwner(ownerId: number): number {
    const ownerTasks = this.tasks.get(ownerId)
    if (!ownerTasks) return 0
    this.tasks.delete(ownerId)
    for (const task of ownerTasks.values()) task.controller.abort()
    return ownerTasks.size
  }
}
