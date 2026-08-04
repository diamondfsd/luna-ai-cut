import { AlertTriangle, Brush, Crosshair, Eye, Loader2, Minus, Plus, Spline, Square, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, ButtonGroup, IconButton, Switch, toast } from '../../ui'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { ParamSlider } from '../components/ParamSlider'
import { hasUsableMask } from '../mask/maskSelectionOperations'
import type { WorkspaceRemovalOperation } from '../../shared/types'
import { activeRemovalOperation, deleteRemovalOperation, latestReadyRemovalOperation, setRemovalOperationEnabled } from './removalOperations'
import './RemovalPanel.css'

const MODEL_VERSION = 'carve-c3c0c9e' as const
const DEFAULT_EDGE_EXPANSION = 4
const DEFAULT_FEATHER = 2

export function RemovalPanel() {
  const edit = useWorkspaceEdit()
  const mask = useWorkspaceMask()
  const { createMask, editing: maskEditing, setManualTool, setSelectionOperation, setSemanticPicking } = mask
  const setMaskReconstructing = mask.setReconstructing
  const media = useWorkspaceMedia()
  const [edgeExpansion, setEdgeExpansion] = useState(DEFAULT_EDGE_EXPANSION)
  const [feather, setFeather] = useState(DEFAULT_FEATHER)
  const [quality, setQuality] = useState<'fast' | 'high'>('high')
  const [processing, setProcessing] = useState(false)
  const requestRef = useRef<string | null>(null)
  const projectRef = useRef(media.currentProject)
  const draftLayerRef = useRef<string | null>(null)
  const removeLayerRef = useRef(mask.removeLayer)
  removeLayerRef.current = mask.removeLayer
  projectRef.current = media.currentProject
  const asset = media.currentProject?.assets[media.activeIndex]
  const operations = asset?.removal?.operations ?? []
  const activeOperation = activeRemovalOperation(operations)
  const activeResult = latestReadyRemovalOperation(operations)
  const ownerKey = `${media.currentProject?.id ?? ''}:${media.activeMedia?.id ?? ''}`
  const ownerKeyRef = useRef(ownerKey)
  ownerKeyRef.current = ownerKey
  const usableMask = Boolean(mask.maskData && hasUsableMask(mask.maskData))
  const isImage = media.activeMedia?.kind === 'image'

  useEffect(() => {
    if (!isImage || maskEditing) return
    createMask()
    setManualTool('instance-stroke')
    setSemanticPicking(false)
    setSelectionOperation('add')
  }, [createMask, isImage, maskEditing, setManualTool, setSelectionOperation, setSemanticPicking])

  useEffect(() => {
    void window.luna.workspace.prepareObjectRemoval().catch(() => undefined)
    return () => {
      if (requestRef.current) void window.luna.workspace.cancelObjectRemoval(requestRef.current)
      if (draftLayerRef.current) removeLayerRef.current(draftLayerRef.current)
      void window.luna.workspace.releaseObjectRemoval().catch(() => undefined)
    }
  }, [])

  useEffect(() => {
    const requestId = requestRef.current
    if (!requestId) return
    requestRef.current = null
    setProcessing(false)
    void window.luna.workspace.cancelObjectRemoval(requestId)
  }, [ownerKey])

  useEffect(() => {
    if (mask.editing && mask.activeLayerId) draftLayerRef.current = mask.activeLayerId
  }, [mask.activeLayerId, mask.editing])

  useEffect(() => {
    setMaskReconstructing(processing)
    return () => setMaskReconstructing(false)
  }, [processing, setMaskReconstructing])

  const saveRemoval = async (
    projectId: string,
    assetId: string,
    nextOperations: WorkspaceRemovalOperation[],
    discardedMaskId?: string,
  ): Promise<boolean> => {
    const project = projectRef.current
    if (!project || project.id !== projectId || ownerKeyRef.current !== `${projectId}:${assetId}`) return false
    const targetIndex = project.assets.findIndex((item) => item.id === assetId)
    if (targetIndex < 0) return false
    const next = {
      ...project,
      assets: project.assets.map((item, index) => {
        if (index !== targetIndex) return item
        const pipeline = discardedMaskId
          ? { ...edit.pipeline, colorMasks: edit.pipeline.colorMasks.filter((layer) => layer.id !== discardedMaskId) }
          : item.pipeline
        return { ...item, pipeline, removal: { schemaVersion: 1 as const, operations: nextOperations } }
      }),
      updatedAt: new Date().toISOString(),
    }
    projectRef.current = next
    media.setCurrentProject(next)
    try {
      await window.luna.workspace.saveProject(next)
      return true
    } catch (error) {
      if (projectRef.current === next) {
        projectRef.current = project
        media.setCurrentProject(project)
      }
      throw error
    }
  }

  const startRemoval = async (): Promise<void> => {
    if (!media.currentProject || !media.activeMedia || !mask.maskData || !mask.maskSize || !usableMask || processing) return
    const projectId = media.currentProject.id
    const assetId = media.activeMedia.id
    const requestOwnerKey = `${projectId}:${assetId}`
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    setProcessing(true)
    let generated: Awaited<ReturnType<typeof window.luna.workspace.removeObject>> | null = null
    try {
      const inputPath = activeResult?.resultPath ?? media.activeMedia.path
      const bytes = mask.maskData.buffer.slice(mask.maskData.byteOffset, mask.maskData.byteOffset + mask.maskData.byteLength)
      const result = await window.luna.workspace.removeObject({
        requestId,
        projectId: media.currentProject.id,
        assetId: media.activeMedia.id,
        filePath: inputPath,
        maskWidth: mask.maskSize.width,
        maskHeight: mask.maskSize.height,
        maskBytes: bytes,
        edgeExpansion,
        feather,
        quality,
      })
      generated = result
      if (requestRef.current !== requestId || ownerKeyRef.current !== requestOwnerKey) {
        await window.luna.workspace.discardObjectRemovalFiles(projectId, [result.resultPath, result.maskPath])
        return
      }
      const operation: WorkspaceRemovalOperation = {
        id: crypto.randomUUID(),
        enabled: true,
        maskPath: result.maskPath,
        maskWidth: mask.maskSize.width,
        maskHeight: mask.maskSize.height,
        maskBytes: result.maskBytes,
        maskSha256: result.maskSha256,
        resultPath: result.resultPath,
        resultBytes: result.resultBytes,
        resultSha256: result.resultSha256,
        inputRevision: activeResult?.resultPath ?? media.activeMedia.path,
        edgeExpansion,
        feather,
        quality,
        model: { id: 'big-lama-fp32', version: MODEL_VERSION, sha256: result.modelSha256 },
        status: 'ready',
        createdAt: new Date().toISOString(),
      }
      const discardedMaskId = mask.activeLayerId ?? undefined
      const saved = await saveRemoval(projectId, assetId, [...operations, operation], discardedMaskId)
      if (!saved) {
        await window.luna.workspace.discardObjectRemovalFiles(projectId, [result.resultPath, result.maskPath])
        return
      }
      generated = null
      if (ownerKeyRef.current !== requestOwnerKey) return
      if (discardedMaskId) mask.removeLayer(discardedMaskId)
      draftLayerRef.current = null
      mask.setEditing(false)
      edit.setCompareOriginal(false)
      toast.success(`消除完成 · ${Math.max(0.1, result.inferenceMs / 1000).toFixed(1)} 秒`)
    } catch (error) {
      if (generated) await window.luna.workspace.discardObjectRemovalFiles(projectId, [generated.resultPath, generated.maskPath])
      if (requestRef.current === requestId) toast.error(error instanceof Error ? error.message : '消除失败，请重试')
    } finally {
      if (requestRef.current === requestId) {
        requestRef.current = null
        setProcessing(false)
      }
    }
  }

  const cancel = (): void => {
    const requestId = requestRef.current
    if (!requestId) return
    requestRef.current = null
    setProcessing(false)
    void window.luna.workspace.cancelObjectRemoval(requestId)
  }

  const persistRemoval = (nextOperations: WorkspaceRemovalOperation[]): void => {
    if (!media.currentProject || !media.activeMedia) return
    void saveRemoval(media.currentProject.id, media.activeMedia.id, nextOperations).catch((error) => {
      toast.error(error instanceof Error ? error.message : '消除步骤保存失败')
    })
  }

  if (!isImage) return <div className="workspace-removal-empty">对象消除当前仅支持普通图片。</div>

  return (
    <div className="workspace-removal-panel">
      <section>
        <h3>选区</h3>
        <ButtonGroup
          options={[
            { value: 'stroke', label: <><Spline size={16} />划选</> },
            { value: 'point', label: <><Crosshair size={16} />智能</> },
            { value: 'brush', label: <><Brush size={16} />画笔</> },
            { value: 'rectangle', label: <><Square size={16} />框选</> },
          ]}
          value={mask.semanticPicking ? 'point' : mask.manualTool === 'instance-stroke' ? 'stroke' : mask.manualTool === 'rectangle' ? 'rectangle' : 'brush'}
          onChange={(value) => {
            mask.setSemanticPicking(value === 'point')
            mask.setManualTool(value === 'stroke' ? 'instance-stroke' : value === 'rectangle' ? 'rectangle' : value === 'brush' ? 'brush' : 'move')
          }}
        />
        {(mask.manualTool === 'instance-stroke' || mask.semanticPicking) && (
          <ParamSlider label="蒙版扩展" value={mask.aiMaskExpansion} min={0} max={12} onChange={mask.setAiMaskExpansion} formatValue={(value) => `${Math.round(value)} px`} />
        )}
        <ButtonGroup
          options={[
            { value: 'add', label: <><Plus size={15} />添加</> },
            { value: 'subtract', label: <><Minus size={15} />减去</> },
          ]}
          value={mask.selectionOperation === 'subtract' ? 'subtract' : 'add'}
          onChange={(value) => mask.setSelectionOperation(value)}
        />
        {mask.manualTool === 'brush' && <ParamSlider label="画笔大小" value={mask.brushSize} min={2} max={100} onChange={mask.setBrushSize} />}
        <label className="workspace-removal-switch"><span>显示选区</span><Switch ariaLabel="显示消除选区" checked={mask.showOverlay} onCheckedChange={mask.setShowOverlay} /></label>
      </section>
      <section>
        <h3>处理质量</h3>
        <ButtonGroup
          options={[
            { value: 'fast', label: '快速' },
            { value: 'high', label: '高清' },
          ]}
          value={quality}
          onChange={setQuality}
        />
      </section>
      <section>
        <h3>边缘</h3>
        <ParamSlider label="扩展" value={edgeExpansion} min={0} max={24} onChange={setEdgeExpansion} formatValue={(value) => `${Math.round(value)} px`} />
        <ParamSlider label="羽化" value={feather} min={0} max={18} onChange={setFeather} formatValue={(value) => `${Math.round(value)} px`} />
      </section>
      {operations.length > 0 && <section className="workspace-removal-steps">
        <h3>消除步骤</h3>
        {operations.map((operation, index) => {
          const needsRegeneration = operation.status === 'needs-regeneration'
          return <div className={`workspace-removal-step${needsRegeneration ? ' is-invalid' : ''}`} key={operation.id}>
            <div className="workspace-removal-step-copy">
              <strong>步骤 {index + 1}</strong>
              <span>{needsRegeneration ? operation.failureReason ?? '需要重新生成' : '已完成'}</span>
            </div>
            <Switch
              ariaLabel={`启用消除步骤 ${index + 1}`}
              checked={operation.enabled}
              disabled={processing || needsRegeneration}
              onCheckedChange={(enabled) => persistRemoval(setRemovalOperationEnabled(operations, operation.id, enabled))}
            />
            <IconButton
              variant="ghost"
              size="mini"
              icon={<Trash2 size={14} />}
              aria-label={`删除消除步骤 ${index + 1}`}
              disabled={processing}
              onClick={() => persistRemoval(deleteRemovalOperation(operations, operation.id))}
            />
          </div>
        })}
      </section>}
      {activeOperation?.status === 'needs-regeneration' && <div className="workspace-removal-warning"><AlertTriangle size={15} /><span>部分消除步骤已经失效，请删除后重新选择区域。</span></div>}
      {activeResult && <section className="workspace-removal-result">
        <h3>结果</h3>
        <Button variant="secondary" className="workspace-removal-full-button" icon={<Eye size={16} />} onPointerDown={() => edit.setCompareOriginal(true)} onPointerUp={() => edit.setCompareOriginal(false)} onPointerLeave={() => edit.setCompareOriginal(false)}>按住查看原图</Button>
        <Button variant="danger" className="workspace-removal-full-button" icon={<Trash2 size={16} />} onClick={() => persistRemoval([])}>删除全部结果</Button>
      </section>}
      <div className="workspace-removal-actions">
        {processing ? <Button variant="secondary" className="workspace-removal-full-button" icon={<X size={16} />} onClick={cancel}>取消处理</Button> : <Button variant="primary" className="workspace-removal-full-button" disabled={!mask.editing || !usableMask || mask.busy} icon={mask.busy ? <Loader2 className="spin" size={16} /> : undefined} onClick={() => void startRemoval()}>开始消除</Button>}
      </div>
    </div>
  )
}
