import { Brush, Eraser, Eye, EyeOff, Loader2, RotateCcw, ScanFace } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { Accordion, Button, ButtonGroup, Switch, toast } from '../../ui'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { ParamSlider } from '../components/ParamSlider'
import {
  BEAUTY_BODY_LAYER_ID,
  BEAUTY_FACE_LAYER_ID,
  BEAUTY_MANUAL_RETOUCH_LAYER_ID,
  DEFAULT_BEAUTY_PARAMETERS,
  beautyLayers,
  beautyParameters,
  isBeautyAnalysisCurrent,
  updateBeautyParameters,
  type BeautyParameters,
} from './beautyLayers'
import { analyzeBeautyForPipeline } from './beautyAnalysisClient'
import { BEAUTY_MASK_VISUALIZATION } from './beautyMaskVisualization'
import './BeautyPanel.css'

export function BeautyPanel() {
  const edit = useWorkspaceEdit()
  const setBeautyMaskPreview = edit.setBeautyMaskPreview
  const setBeautyRetouchActive = edit.setBeautyRetouchActive
  const setBeautyRetouchMode = edit.setBeautyRetouchMode
  const media = useWorkspaceMedia()
  const activeAsset = media.currentProject?.assets[media.activeIndex] ?? null
  const layers = useMemo(() => beautyLayers(edit.pipeline), [edit.pipeline])
  const parameters = useMemo(() => beautyParameters(edit.pipeline), [edit.pipeline])
  const hasSkinAnalysis = Boolean(layers.face && layers.body)
  const analyzed = useMemo(() => isBeautyAnalysisCurrent(edit.pipeline), [edit.pipeline])
  const manualLayer = edit.pipeline.beautyMasks.find((layer) => layer.id === BEAUTY_MANUAL_RETOUCH_LAYER_ID)
  const enabled = Boolean(layers.face?.enabled || layers.body?.enabled || manualLayer?.enabled)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState('')
  const [progressPercent, setProgressPercent] = useState<number | null>(null)
  const [analysisError, setAnalysisError] = useState('')
  const requestRef = useRef<string | null>(null)
  const attemptedAssetRef = useRef<string | null>(null)

  const cancel = useCallback(() => {
    const requestId = requestRef.current
    requestRef.current = null
    if (requestId) void window.luna.workspace.cancelSegmentation(requestId)
    setBusy(false)
    setStatus('')
    setProgressPercent(null)
  }, [])

  useEffect(() => {
    attemptedAssetRef.current = null
    setAnalysisError('')
    setBeautyMaskPreview(false)
    setBeautyRetouchActive(false)
    setBeautyRetouchMode(null)
    return cancel
  }, [activeAsset?.id, cancel, setBeautyMaskPreview, setBeautyRetouchActive, setBeautyRetouchMode])

  useEffect(() => () => {
    setBeautyMaskPreview(false)
    setBeautyRetouchActive(false)
    setBeautyRetouchMode(null)
  }, [setBeautyMaskPreview, setBeautyRetouchActive, setBeautyRetouchMode])

  useEffect(() => {
    if (!analyzed || activeAsset?.kind !== 'image') return
    setBeautyMaskPreview(false)
    setBeautyRetouchActive(true)
  }, [activeAsset?.id, activeAsset?.kind, analyzed, setBeautyMaskPreview, setBeautyRetouchActive])

  useEffect(() => window.luna.onWorkspaceSegmentationProgress((progress) => {
    if (progress.requestId !== requestRef.current) return
    setStatus(progress.label)
    setProgressPercent(progress.percent)
  }), [])

  const commitParameters = useCallback((next: BeautyParameters) => {
    edit.commitPatch({ beautyMasks: updateBeautyParameters(edit.pipeline, next) })
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
    setProgressPercent(null)
    const currentParameters = hasSkinAnalysis ? parameters : DEFAULT_BEAUTY_PARAMETERS
    try {
      const beautyMasks = await analyzeBeautyForPipeline({
        requestId,
        projectId: media.currentProject.id,
        assetId: activeAsset.id,
        filePath: activeAsset.path,
        parameters: currentParameters,
        onStatus: (nextStatus) => {
          setStatus(nextStatus)
          setProgressPercent(null)
        },
        shouldContinue: () => requestRef.current === requestId,
      })
      if (beautyMasks) {
        const manual = edit.pipeline.beautyMasks.find((layer) => layer.id === BEAUTY_MANUAL_RETOUCH_LAYER_ID)
        edit.commitPatch({ beautyMasks: manual ? [manual, ...beautyMasks] : beautyMasks })
      }
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
        setProgressPercent(null)
      }
    }
  }, [activeAsset, cancel, edit, hasSkinAnalysis, media.currentProject, parameters])

  useEffect(() => {
    if (analyzed || busy || activeAsset?.kind !== 'image' || !media.currentProject) return
    const assetKey = `${media.currentProject.id}:${activeAsset.id}`
    if (attemptedAssetRef.current === assetKey) return
    attemptedAssetRef.current = assetKey
    void analyze()
  }, [activeAsset, analyze, analyzed, busy, media.currentProject])

  const setEnabled = (next: boolean) => {
    edit.commitPatch({
      beautyMasks: edit.pipeline.beautyMasks.map((layer) => (
        layer.id === BEAUTY_FACE_LAYER_ID
          || layer.id === BEAUTY_BODY_LAYER_ID
          || layer.id === BEAUTY_MANUAL_RETOUCH_LAYER_ID
          ? { ...layer, enabled: next }
          : layer
      )),
    })
  }

  const reset = () => commitParameters({ faceWhitening: 0, skinWhitening: 0, skinWarmth: 0, smoothing: 0, texture: 0, acneRemoval: 0, spotRemoval: 0, wrinkleReduction: 0 })

  const clearManualRetouch = () => {
    edit.commitPatch({
      beautyMasks: edit.pipeline.beautyMasks.filter((layer) => layer.id !== BEAUTY_MANUAL_RETOUCH_LAYER_ID),
    })
  }

  return (
    <div className="beauty-panel">
      <div className="beauty-panel-summary">
        <div>
          <strong>自然美颜</strong>
          <span>{analyzed ? '已识别人脸和皮肤' : '本地识别人脸和皮肤'}</span>
        </div>
        {analyzed && <Switch checked={enabled} onCheckedChange={setEnabled} ariaLabel="启用美颜" />}
      </div>

      {busy && (
        <div className="beauty-analysis-status" role="status">
          <Loader2 className="spin" size={16} />
          <div className="beauty-analysis-status-content">
            <div>
              <span>{status || '正在识别人脸和皮肤'}</span>
              {progressPercent !== null && <strong>{progressPercent}%</strong>}
            </div>
            {progressPercent !== null && (
              <div className="beauty-analysis-progress" aria-label={`美颜模型准备进度 ${progressPercent}%`}>
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            )}
          </div>
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
        <>
          <div className="beauty-mask-test">
            <Button
              variant="secondary"
              size="compact"
              icon={edit.beautyMaskPreview ? <EyeOff size={15} /> : <Eye size={15} />}
              aria-pressed={edit.beautyMaskPreview}
              onClick={() => {
                const next = !edit.beautyMaskPreview
                setBeautyRetouchActive(!next)
                setBeautyMaskPreview(next)
              }}
            >
              {edit.beautyMaskPreview ? '关闭蒙版' : '测试蒙版'}
            </Button>
            {edit.beautyMaskPreview && (
              <div className="beauty-mask-legend" aria-label="美颜蒙版图例">
                {BEAUTY_MASK_VISUALIZATION.map((item) => (
                  <span key={item.id} className="beauty-mask-legend-item">
                    <i style={{ backgroundColor: item.color }} aria-hidden="true" />
                    {item.label}
                  </span>
                ))}
              </div>
            )}
          </div>
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
            label="肤色暖调"
            value={parameters.skinWarmth}
            min={0}
            max={100}
            onChange={(skinWarmth) => commitParameters({ ...parameters, skinWarmth })}
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
          <ParamSlider
            label="质感"
            value={parameters.texture}
            min={0}
            max={100}
            onChange={(texture) => commitParameters({ ...parameters, texture })}
            formatValue={(value) => String(value)}
          />
          </Accordion>
          <Accordion
            title="局部修复"
            defaultOpen
            modified={Boolean(manualLayer)}
            actions={manualLayer ? (
              <button
                className="workspace-acc-reset"
                type="button"
                onClick={clearManualRetouch}
                title="清除局部修复"
                aria-label="清除局部修复"
              >
                <RotateCcw size={11} />
              </button>
            ) : undefined}
          >
            <ButtonGroup
              className="beauty-retouch-modes"
              ariaLabel="局部修复方式"
              value={edit.beautyRetouchMode ?? 'none'}
              onChange={(mode) => {
                if (mode === edit.beautyRetouchMode) setBeautyRetouchMode(null)
                else if (mode === 'repair' || mode === 'erase') setBeautyRetouchMode(mode)
              }}
              options={[
                { value: 'repair', label: <><Brush size={15} />修复</> },
                { value: 'erase', label: <><Eraser size={15} />擦除</> },
              ]}
            />
            <ParamSlider
              label="画笔大小"
              value={edit.beautyRetouchBrushSize}
              min={6}
              max={80}
              onChange={edit.setBeautyRetouchBrushSize}
              formatValue={(value) => String(value)}
            />
          </Accordion>
        </>
      )}
    </div>
  )
}
