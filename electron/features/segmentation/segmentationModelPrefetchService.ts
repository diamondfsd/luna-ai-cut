import type { SegmentationModelId, SingleFileSegmentationModelId } from '../../../src/shared/segmentationModels.js'
import { logMainInfo, logMainWarn } from '../../infrastructure/loggerService.js'
import { loadModel } from '../../infrastructure/modelLoader.js'

interface PrefetchItem {
  modelId: SingleFileSegmentationModelId
  label: string
  load: (signal: AbortSignal) => Promise<unknown>
}

const PREFETCH_ITEMS: PrefetchItem[] = [
  {
    modelId: 'rmbg-1.4',
    label: '主体模型',
    load: (signal) => loadModel('rmbg-1.4', undefined, signal),
  },
  {
    modelId: 'segformer-b5-ade20k',
    label: '语义模型',
    load: (signal) => loadModel('segformer-b5-ade20k', undefined, signal),
  },
]

const foregroundCounts = new Map<SegmentationModelId, number>()
const foregroundWaiters = new Set<() => void>()
let activePrefetch: { modelId: SingleFileSegmentationModelId; controller: AbortController } | null = null
let started = false
let stopped = false

function wakeForegroundWaiters(): void {
  for (const resolve of foregroundWaiters) resolve()
  foregroundWaiters.clear()
}

async function waitForPriority(modelId: SingleFileSegmentationModelId): Promise<void> {
  while (!stopped && foregroundCounts.size > 0 && !foregroundCounts.has(modelId)) {
    await new Promise<void>((resolve) => foregroundWaiters.add(resolve))
  }
}

async function prefetchItem(item: PrefetchItem): Promise<void> {
  while (!stopped) {
    await waitForPriority(item.modelId)
    if (stopped) return

    const controller = new AbortController()
    activePrefetch = { modelId: item.modelId, controller }
    logMainInfo('[Mask] 后台模型准备开始', { modelId: item.modelId, label: item.label })
    try {
      await item.load(controller.signal)
      logMainInfo('[Mask] 后台模型准备完成', { modelId: item.modelId, label: item.label })
      return
    } catch (error) {
      if (controller.signal.aborted && !stopped) {
        logMainInfo('[Mask] 后台模型准备让位于前台任务', { modelId: item.modelId, label: item.label })
        continue
      }
      if (!stopped) {
        logMainWarn('[Mask] 后台模型准备失败，将在实际使用时重试', {
          modelId: item.modelId,
          label: item.label,
          reason: error instanceof Error ? error.message : String(error),
        })
      }
      return
    } finally {
      if (activePrefetch?.controller === controller) activePrefetch = null
    }
  }
}

export function startSegmentationModelPrefetch(): void {
  if (started || process.env.LUNA_DISABLE_MODEL_PREFETCH === '1' || process.env.LUNA_E2E_USER_DATA_DIR) return
  started = true
  stopped = false
  void (async () => {
    logMainInfo('[Mask] 启动后台模型准备队列', { priority: PREFETCH_ITEMS.map((item) => item.label) })
    for (const item of PREFETCH_ITEMS) await prefetchItem(item)
    if (!stopped) logMainInfo('[Mask] 后台模型准备队列完成')
  })()
}

export function stopSegmentationModelPrefetch(): void {
  stopped = true
  activePrefetch?.controller.abort(new Error('应用正在退出'))
  activePrefetch = null
  wakeForegroundWaiters()
}

export function beginForegroundSegmentation(modelId: SegmentationModelId): () => void {
  foregroundCounts.set(modelId, (foregroundCounts.get(modelId) ?? 0) + 1)
  if (activePrefetch && activePrefetch.modelId !== modelId) {
    activePrefetch.controller.abort(new Error('前台自动选择优先'))
  }

  let finished = false
  return () => {
    if (finished) return
    finished = true
    const remaining = (foregroundCounts.get(modelId) ?? 1) - 1
    if (remaining > 0) foregroundCounts.set(modelId, remaining)
    else foregroundCounts.delete(modelId)
    wakeForegroundWaiters()
  }
}
