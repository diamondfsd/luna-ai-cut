import { Loader2, RotateCcw, ScanFace } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Accordion, Button, Switch, toast } from '../../ui'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { ParamSlider } from '../components/ParamSlider'
import {
  BEAUTY_BODY_LAYER_ID,
  BEAUTY_FACE_LAYER_ID,
  DEFAULT_BEAUTY_PARAMETERS,
  beautyLayers,
  beautyParameters,
  createBeautyMaskLayer,
  replaceBeautyLayers,
  updateBeautyParameters,
  type BeautyParameters,
} from './beautyLayers'
import './BeautyPanel.css'

export function BeautyPanel() {
  const edit = useWorkspaceEdit()
  const media = useWorkspaceMedia()
  const activeAsset = media.currentProject?.assets[media.activeIndex] ?? null
  const layers = useMemo(() => beautyLayers(edit.pipeline), [edit.pipeline])
  const parameters = useMemo(() => beautyParameters(edit.pipeline), [edit.pipeline])
  const analyzed = Boolean(layers.face && layers.body)
  const enabled = Boolean(layers.face?.enabled || layers.body?.enabled)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [analysisError, setAnalysisError] = useState('')
  const requestRef = useRef<string | null>(null)
  const attemptedAssetRef = useRef<string | null>(null)

  const cancel = useCallback(() => {
    const requestId = requestRef.current
    requestRef.current = null
    if (requestId) void window.luna.workspace.cancelSegmentation(requestId)
    setBusy(false)
    setStatus('')
  }, [])

  useEffect(() => {
    attemptedAssetRef.current = null
    setAnalysisError('')
    return cancel
  }, [activeAsset?.id, cancel])

  useEffect(() => window.luna.onWorkspaceSegmentationProgress((progress) => {
    if (progress.requestId !== requestRef.current) return
    setStatus(progress.label)
  }), [])

  const commitParameters = useCallback((next: BeautyParameters) => {
    edit.commitPatch({ colorMasks: updateBeautyParameters(edit.pipeline, next) })
  }, [edit])

  const analyze = useCallback(async () => {
    if (!media.currentProject || !activeAsset || activeAsset.kind !== 'image') {
      toast.error('请先在项目中打开一张图片')
      return
    }
    cancel()
    setAnalysisError('')
    const requestId = `beauty-${crypto.randomUUID()}`
    requestRef.current = requestId
    setBusy(true)
    setStatus('正在准备美颜模型')
    const currentParameters = analyzed ? parameters : DEFAULT_BEAUTY_PARAMETERS
    try {
      const result = await window.luna.workspace.analyzeBeauty({ requestId, filePath: activeAsset.path })
      if (requestRef.current !== requestId) return
      setStatus('正在保存皮肤区域')
      const [faceSaved, bodySaved] = await Promise.all([
        window.luna.workspace.saveColorMask(media.currentProject.id, activeAsset.id, result.width, result.height, result.faceMask, 0),
        window.luna.workspace.saveColorMask(media.currentProject.id, activeAsset.id, result.width, result.height, result.skinMask, 0),
      ])
      if (requestRef.current !== requestId) return
      const faceLayer = createBeautyMaskLayer('face', faceSaved, currentParameters)
      const bodyLayer = createBeautyMaskLayer('body', bodySaved, currentParameters)
      edit.commitPatch({ colorMasks: replaceBeautyLayers(edit.pipeline, faceLayer, bodyLayer) })
    } catch (error) {
      if (requestRef.current !== requestId) return
      const message = error instanceof Error ? error.message : '美颜分析失败'
      setAnalysisError(message)
      toast.error(message)
    } finally {
      if (requestRef.current === requestId) {
        requestRef.current = null
        setBusy(false)
        setStatus('')
      }
    }
  }, [activeAsset, analyzed, cancel, edit, media.currentProject, parameters])

  useEffect(() => {
    if (analyzed || busy || activeAsset?.kind !== 'image' || !media.currentProject) return
    const assetKey = `${media.currentProject.id}:${activeAsset.id}`
    if (attemptedAssetRef.current === assetKey) return
    attemptedAssetRef.current = assetKey
    void analyze()
  }, [activeAsset, analyze, analyzed, busy, media.currentProject])

  const setEnabled = (next: boolean) => {
    edit.commitPatch({
      colorMasks: edit.pipeline.colorMasks.map((layer) => (
        layer.id === BEAUTY_FACE_LAYER_ID || layer.id === BEAUTY_BODY_LAYER_ID
          ? { ...layer, enabled: next }
          : layer
      )),
    })
  }

  const reset = () => commitParameters({ faceWhitening: 0, skinWhitening: 0, smoothing: 0 })

  return (
    <div className="beauty-panel">
      <div className="beauty-panel-summary">
        <div>
          <strong>自然美颜</strong>
          <span>{analyzed ? '已识别人脸和可见皮肤' : '本地识别人脸和可见皮肤'}</span>
        </div>
        {analyzed && <Switch checked={enabled} onCheckedChange={setEnabled} ariaLabel="启用美颜" />}
      </div>

      {busy && (
        <div className="beauty-analysis-status" role="status">
          <Loader2 className="spin" size={16} />
          <span>{status || '正在识别人脸和皮肤'}</span>
        </div>
      )}
      {!busy && !analyzed && analysisError && (
        <div className="beauty-analysis-error" role="alert">
          <span>{analysisError}</span>
          <Button
            variant="secondary"
            size="compact"
            icon={<ScanFace size={16} />}
            onClick={() => void analyze()}
          >
            重试识别
          </Button>
        </div>
      )}

      {analyzed && (
        <Accordion
          title="肤质与美白"
          defaultOpen
          actions={(
            <button className="workspace-acc-reset" type="button" onClick={reset} title="重置美颜参数">
              <RotateCcw size={11} />
            </button>
          )}
        >
          <ParamSlider
            label="面部美白"
            value={parameters.faceWhitening}
            min={0}
            max={100}
            onChange={(faceWhitening) => commitParameters({ ...parameters, faceWhitening })}
            formatValue={(value) => String(value)}
          />
          <ParamSlider
            label="皮肤整体美白"
            value={parameters.skinWhitening}
            min={0}
            max={100}
            onChange={(skinWhitening) => commitParameters({ ...parameters, skinWhitening })}
            formatValue={(value) => String(value)}
          />
          <ParamSlider
            label="磨皮"
            value={parameters.smoothing}
            min={0}
            max={100}
            onChange={(smoothing) => commitParameters({ ...parameters, smoothing })}
            formatValue={(value) => String(value)}
          />
        </Accordion>
      )}
    </div>
  )
}
