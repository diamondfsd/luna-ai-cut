import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CircleAlert, Copy, Download, Loader2, RefreshCw } from 'lucide-react'
import { Checkbox as RadixCheckbox } from 'radix-ui'

import type {
  ManagedModelCategory,
  ManagedModelProgress,
  ManagedModelStatus,
} from '../shared/types'
import { formatBytes } from '../lib/format'
import { Button, LoadingIndicator, Table, toast } from '../ui'
import type { Column } from '../ui'
import './ModelManager.css'

const CATEGORY_ORDER: ManagedModelCategory[] = [
  'segmentation',
  'selection',
  'subtitle',
  'removal',
  'audio',
  'tts',
]

const CATEGORY_LABELS: Record<ManagedModelCategory, string> = {
  segmentation: '分割与检测',
  selection: 'AI 选片',
  subtitle: '字幕识别',
  removal: '画面消除',
  audio: '音乐与音效',
  tts: '语音生成',
}

function getModelManager() {
  return typeof window !== 'undefined' ? window.luna?.modelManager ?? null : null
}

function formatModelSize(bytes: number): string {
  return bytes > 0 ? formatBytes(bytes) : '大小将在环境准备后显示'
}

function ModelCheckbox({ checked, disabled, label, onCheckedChange }: {
  checked: boolean
  disabled?: boolean
  label: string
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <RadixCheckbox.Root
      className="model-manager-checkbox"
      checked={checked}
      disabled={disabled}
      aria-label={label}
      onCheckedChange={(value) => onCheckedChange(value === true)}
    >
      <RadixCheckbox.Indicator>
        <Check size={13} />
      </RadixCheckbox.Indicator>
    </RadixCheckbox.Root>
  )
}

export function ModelManager() {
  const [models, setModels] = useState<ManagedModelStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [preparingId, setPreparingId] = useState<string | null>(null)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  const [batchState, setBatchState] = useState<{ total: number; completed: number } | null>(null)
  const [progressById, setProgressById] = useState<Record<string, ManagedModelProgress>>({})
  const [errorById, setErrorById] = useState<Record<string, string>>({})
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set())
  const downloadingRef = useRef(false)

  const refresh = useCallback(async () => {
    const api = getModelManager()
    if (!api) {
      setModels([])
      setLoading(false)
      return
    }

    setLoading(true)
    try {
      setModels(await api.list())
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '模型列表读取失败')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const api = getModelManager()
    if (!api) return undefined
    return api.onProgress((progress) => {
      setProgressById((current) => ({ ...current, [progress.modelId]: progress }))
    })
  }, [refresh])

  const orderedModels = useMemo(
    () => CATEGORY_ORDER.flatMap((category) => models.filter((model) => model.category === category)),
    [models],
  )

  const downloadableModels = useMemo(
    () => models.filter((model) => model.available && !model.cached),
    [models],
  )
  const selectedModels = useMemo(
    () => selectedIds.map((id) => models.find((model) => model.id === id)).filter((model): model is ManagedModelStatus => Boolean(model && model.available && !model.cached)),
    [models, selectedIds],
  )
  const allDownloadableSelected = downloadableModels.length > 0 && selectedModels.length === downloadableModels.length
  const isDownloading = batchState !== null

  const setModelError = useCallback((modelId: string, message: string | null) => {
    setErrorById((current) => {
      const next = { ...current }
      if (message) next[modelId] = message
      else delete next[modelId]
      return next
    })
  }, [])

  const downloadModels = useCallback(async (requestedModels: ManagedModelStatus[]) => {
    const api = getModelManager()
    const targets = requestedModels.filter((model) => model.available && !model.cached)
    if (!api || targets.length === 0 || downloadingRef.current) return

    downloadingRef.current = true
    setBatchState({ total: targets.length, completed: 0 })
    let succeeded = 0
    let failed = 0

    try {
      for (const [index, model] of targets.entries()) {
        setBatchState({ total: targets.length, completed: index })
        setPreparingId(model.id)
        setModelError(model.id, null)
        try {
          const nextStatus = await api.prepare(model.id)
          setModels((current) => current.map((item) => item.id === nextStatus.id ? nextStatus : item))
          setSelectedIds((current) => current.filter((id) => id !== model.id))
          succeeded += 1
        } catch (error) {
          const message = error instanceof Error ? error.message : '模型下载失败，请重试'
          setModelError(model.id, message)
          failed += 1
        } finally {
          setPreparingId(null)
          setProgressById((current) => {
            const next = { ...current }
            delete next[model.id]
            return next
          })
        }
      }
      if (failed > 0) {
        toast.error(`已完成 ${succeeded} 个模型，${failed} 个模型下载失败`)
      } else if (succeeded === 1) {
        toast.success(`${targets[0].name}已准备完成`)
      } else {
        toast.success(`已完成 ${succeeded} 个模型下载`)
      }
    } finally {
      downloadingRef.current = false
      setBatchState(null)
      setPreparingId(null)
    }
  }, [setModelError])

  const toggleModel = useCallback((modelId: string, checked: boolean) => {
    setSelectedIds((current) => checked
      ? current.includes(modelId) ? current : [...current, modelId]
      : current.filter((id) => id !== modelId))
  }, [])

  const toggleAll = useCallback((checked: boolean) => {
    setSelectedIds(checked ? downloadableModels.map((model) => model.id) : [])
  }, [downloadableModels])

  const copyDownloadUrls = useCallback(async (model: ManagedModelStatus) => {
    try {
      await navigator.clipboard.writeText(model.downloadUrls.join('\n'))
      toast.success('下载地址已复制')
    } catch {
      toast.error('下载地址复制失败')
    }
  }, [])

  const toggleExpanded = useCallback((modelId: string) => {
    setExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(modelId)) next.delete(modelId)
      else next.add(modelId)
      return next
    })
  }, [])

  const sourceHost = useCallback((url: string) => {
    try {
      return new URL(url).host.replace(/^www\./, '')
    } catch {
      return url
    }
  }, [])

  const downloadedCount = models.filter((model) => model.cached).length

  const columns: Column<ManagedModelStatus>[] = [
    {
      key: 'select',
      label: '',
      width: 42,
      render: (model) => model.available && !model.cached
        ? (
          <ModelCheckbox
            checked={selectedIds.includes(model.id)}
            disabled={isDownloading}
            label={`选择${model.name}`}
            onCheckedChange={(checked) => toggleModel(model.id, checked)}
          />
        )
        : <span className="model-manager-checkbox-placeholder" aria-hidden="true" />,
    },
    {
      key: 'name',
      label: '模型',
      render: (model) => (
        <div className="model-manager-table-name">
          <strong>{model.name}</strong>
          <span>{model.description}</span>
        </div>
      ),
    },
    {
      key: 'category',
      label: '类别',
      width: 96,
      render: (model) => <span className="model-manager-table-muted">{CATEGORY_LABELS[model.category]}</span>,
    },
    {
      key: 'size',
      label: '大小',
      width: 118,
      render: (model) => <span className="model-manager-table-muted">{formatModelSize(model.sizeBytes)}</span>,
    },
    {
      key: 'source',
      label: '下载来源',
      width: 154,
      render: (model) => (
        <div className="model-manager-table-source" title={model.downloadUrls.join('\n')}>
          <strong>{model.downloadUrls.length > 0 ? sourceHost(model.downloadUrls[0]) : '未提供'}</strong>
          {model.downloadUrls.length > 1 && <span>另有 {model.downloadUrls.length - 1} 个地址</span>}
        </div>
      ),
    },
    {
      key: 'status',
      label: '状态',
      width: 190,
      render: (model) => {
        const progress = progressById[model.id]
        const isPreparing = preparingId === model.id
        const error = errorById[model.id]
        const percentage = progress?.fraction === null || progress?.fraction === undefined
          ? null
          : Math.round(progress.fraction * 100)

        if (model.cached) return <span className="model-manager-ready"><Check size={13} />已下载</span>
        if (!model.available) return <span className="model-manager-unavailable">当前环境不可用</span>
        return (
          <div className="model-manager-table-status">
            <div className="model-manager-table-status-line">
              <span>{isPreparing ? '下载中' : '未下载'}</span>
              {isPreparing && percentage !== null && <strong>{percentage}%</strong>}
            </div>
            {isPreparing && progress && (
              <div className="model-manager-progress-track" role="progressbar" aria-valuenow={percentage ?? undefined} aria-valuemin={0} aria-valuemax={100}>
                <span style={percentage === null ? undefined : { width: `${percentage}%` }} />
              </div>
            )}
            {isPreparing && progress?.stage && <small title={progress.stage}>{progress.stage}</small>}
            {error && <em>{error}</em>}
          </div>
        )
      },
    },
    {
      key: 'action',
      label: '操作',
      width: 108,
      render: (model) => {
        const isPreparing = preparingId === model.id
        return (
          <Button
            variant={model.cached ? 'secondary' : 'primary'}
            size="compact"
            icon={isPreparing
              ? <Loader2 size={14} className="model-manager-spin" />
              : model.cached
                ? <Check size={14} />
                : model.available
                  ? <Download size={14} />
                  : <CircleAlert size={14} />}
            onClick={() => void downloadModels([model])}
            disabled={isPreparing || isDownloading || model.cached || !model.available}
          >
            {isPreparing ? '下载中' : model.cached ? '已下载' : model.available ? '下载' : '不可用'}
          </Button>
        )
      },
    },
  ]

  return (
    <div className="model-manager">
      <div className="model-manager-header">
        <div className="model-manager-heading">
          <strong>本地模型</strong>
          {!loading && models.length > 0 && (
            <small>已下载 {downloadedCount} / {models.length} 个模型</small>
          )}
        </div>
        <div className="model-manager-header-actions">
          {models.length > 0 && (
            <div className="model-manager-select-all">
              <ModelCheckbox
                checked={allDownloadableSelected}
                disabled={isDownloading || downloadableModels.length === 0}
                label="全选可下载模型"
                onCheckedChange={toggleAll}
              />
              <span>全选可下载</span>
            </div>
          )}
          {models.length > 0 && (
            <Button
              variant="primary"
              size="compact"
              icon={<Download size={15} />}
              onClick={() => void downloadModels(selectedModels)}
              disabled={isDownloading || selectedModels.length === 0}
            >
              {isDownloading ? `下载中 ${Math.min((batchState?.completed ?? 0) + 1, batchState?.total ?? 1)} / ${batchState?.total ?? 1}` : `一键下载${selectedModels.length > 0 ? ` (${selectedModels.length})` : ''}`}
            </Button>
          )}
          <Button
            variant="secondary"
            size="compact"
            icon={<RefreshCw size={15} className={loading ? 'model-manager-spin' : undefined} />}
            onClick={() => void refresh()}
            disabled={loading || isDownloading}
          >
            {loading ? '读取中' : '刷新'}
          </Button>
        </div>
      </div>

      {loading && models.length === 0 && (
        <div className="model-manager-state">
          <LoadingIndicator label="正在读取模型列表" />
        </div>
      )}

      {!loading && models.length === 0 && (
        <div className="model-manager-state">暂时无法读取模型列表</div>
      )}

      {!loading && models.length > 0 && (
        <Table
          className="model-manager-table"
          columns={columns}
          data={orderedModels}
          keyExtractor={(model) => model.id}
          maxHeight="min(62vh, 560px)"
          expandedKeys={expandedIds}
          onExpandToggle={toggleExpanded}
          expandContent={(model) => (
            <div className="model-manager-source-panel">
              <div className="model-manager-source-panel-header">
                <span>实际候选下载地址</span>
                <Button variant="ghost" size="mini" icon={<Copy size={13} />} onClick={() => void copyDownloadUrls(model)}>
                  复制地址
                </Button>
              </div>
              {model.downloadUrls.length > 0
                ? <div className="model-manager-source-list">{model.downloadUrls.map((url) => <code key={url}>{url}</code>)}</div>
                : <span className="model-manager-table-muted">暂未提供下载地址</span>}
            </div>
          )}
        />
      )}
    </div>
  )
}
