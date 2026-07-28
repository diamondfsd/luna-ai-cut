import { Brush, Crosshair, Eye, Loader2, Minus, Plus, Spline, Square, Trash2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button, ButtonGroup, Switch, toast } from '../../ui'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { ParamSlider } from '../components/ParamSlider'
import { hasUsableMask } from '../mask/maskSelectionOperations'
import type { WorkspaceRemovalOperation } from '../../shared/types'
import './RemovalPanel.css'

const MODEL_VERSION = 'carve-c3c0c9e' as const
const DEFAULT_EDGE_EXPANSION = 0

export function RemovalPanel() {
  const edit = useWorkspaceEdit()
  const mask = useWorkspaceMask()
  const { createMask, editing: maskEditing, setManualTool, setSelectionOperation, setSemanticPicking } = mask
  const setMaskReconstructing = mask.setReconstructing
  const media = useWorkspaceMedia()
  const [edgeExpansion, setEdgeExpansion] = useState(DEFAULT_EDGE_EXPANSION)
  const [feather, setFeather] = useState(0)
  const [processing, setProcessing] = useState(false)
  const requestRef = useRef<string | null>(null)
  const draftLayerRef = useRef<string | null>(null)
  const removeLayerRef = useRef(mask.removeLayer)
  removeLayerRef.current = mask.removeLayer
  const asset = media.currentProject?.assets[media.activeIndex]
  const operations = asset?.removal?.operations ?? []
  const activeResult = [...operations].reverse().find((operation) => operation.enabled)
  const usableMask = Boolean(mask.maskData && hasUsableMask(mask.maskData))
  const isImage = media.activeMedia?.kind === 'image'

  useEffect(() => {
    if (!isImage || maskEditing) return
    createMask()
    setManualTool('instance-stroke')
    setSemanticPicking(false)
    setSelectionOperation('add')
  }, [createMask, isImage, maskEditing, setManualTool, setSelectionOperation, setSemanticPicking])

  useEffect(() => () => {
    if (requestRef.current) void window.luna.workspace.cancelObjectRemoval(requestRef.current)
    if (draftLayerRef.current) removeLayerRef.current(draftLayerRef.current)
  }, [])

  useEffect(() => {
    if (mask.editing && mask.activeLayerId) draftLayerRef.current = mask.activeLayerId
  }, [mask.activeLayerId, mask.editing])

  useEffect(() => {
    setMaskReconstructing(processing)
    return () => setMaskReconstructing(false)
  }, [processing, setMaskReconstructing])

  const saveRemoval = async (nextOperations: WorkspaceRemovalOperation[], discardedMaskId?: string): Promise<void> => {
    const project = media.currentProject
    if (!project) return
    const next = {
      ...project,
      assets: project.assets.map((item, index) => {
        if (index !== media.activeIndex) return item
        const pipeline = discardedMaskId
          ? { ...edit.pipeline, colorMasks: edit.pipeline.colorMasks.filter((layer) => layer.id !== discardedMaskId) }
          : item.pipeline
        return { ...item, pipeline, removal: { schemaVersion: 1 as const, operations: nextOperations } }
      }),
      updatedAt: new Date().toISOString(),
    }
    media.setCurrentProject(next)
    await window.luna.workspace.saveProject(next)
  }

  const startRemoval = async (): Promise<void> => {
    if (!media.currentProject || !media.activeMedia || !mask.maskData || !mask.maskSize || !usableMask || processing) return
    const requestId = crypto.randomUUID()
    requestRef.current = requestId
    setProcessing(true)
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
      })
      if (requestRef.current !== requestId) return
      const operation: WorkspaceRemovalOperation = {
        id: crypto.randomUUID(),
        enabled: true,
        maskPath: result.maskPath,
        maskWidth: mask.maskSize.width,
        maskHeight: mask.maskSize.height,
        resultPath: result.resultPath,
        inputRevision: activeResult?.resultPath ?? media.activeMedia.path,
        edgeExpansion,
        feather,
        model: { id: 'big-lama-fp32', version: MODEL_VERSION, sha256: result.modelSha256 },
        createdAt: new Date().toISOString(),
      }
      const discardedMaskId = mask.activeLayerId ?? undefined
      if (discardedMaskId) mask.removeLayer(discardedMaskId)
      draftLayerRef.current = null
      await saveRemoval([...operations, operation], discardedMaskId)
      mask.setEditing(false)
      edit.setCompareOriginal(false)
      toast.success(`消除完成 · ${Math.max(0.1, result.inferenceMs / 1000).toFixed(1)} 秒`)
    } catch (error) {
      if (requestRef.current === requestId) toast.error(error instanceof Error ? error.message : '消除失败，请重试')
    } finally {
      if (requestRef.current === requestId) requestRef.current = null
      setProcessing(false)
    }
  }

  const cancel = (): void => {
    const requestId = requestRef.current
    if (!requestId) return
    requestRef.current = null
    setProcessing(false)
    void window.luna.workspace.cancelObjectRemoval(requestId)
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
        <h3>边缘</h3>
        <ParamSlider label="扩展" value={edgeExpansion} min={0} max={24} onChange={setEdgeExpansion} formatValue={(value) => `${Math.round(value)} px`} />
        <ParamSlider label="羽化" value={feather} min={0} max={18} onChange={setFeather} formatValue={(value) => `${Math.round(value)} px`} />
      </section>
      {activeResult && <section className="workspace-removal-result">
        <h3>结果</h3>
        <Button variant="secondary" className="workspace-removal-full-button" icon={<Eye size={16} />} onPointerDown={() => edit.setCompareOriginal(true)} onPointerUp={() => edit.setCompareOriginal(false)} onPointerLeave={() => edit.setCompareOriginal(false)}>按住查看原图</Button>
        <Button variant="danger" className="workspace-removal-full-button" icon={<Trash2 size={16} />} onClick={() => void saveRemoval([])}>删除消除结果</Button>
      </section>}
      <div className="workspace-removal-actions">
        {processing ? <Button variant="secondary" className="workspace-removal-full-button" icon={<X size={16} />} onClick={cancel}>取消处理</Button> : <Button variant="primary" className="workspace-removal-full-button" disabled={!mask.editing || !usableMask || mask.busy} icon={mask.busy ? <Loader2 className="spin" size={16} /> : undefined} onClick={() => void startRemoval()}>开始消除</Button>}
      </div>
    </div>
  )
}
