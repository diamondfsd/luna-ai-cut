import { RotateCcw, ScanFace } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, LoadingIndicator, Switch } from '../../ui'
import { isImagePath } from '../../lib/fileUtils'
import { ParamSlider } from '../components/ParamSlider'
import type { BeautySettings } from '../shared/editPipeline'
import { detectBeautyFaces } from './faceLandmarker'
import '../../styles/workspace-beauty.css'

interface BeautyPanelProps {
  value: BeautySettings
  filePath?: string
  onChange: (patch: Partial<BeautySettings>) => void
  debug: boolean
  onDebugChange: (value: boolean) => void
}

export function BeautyPanel({ value, filePath, onChange, debug, onDebugChange }: BeautyPanelProps) {
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'ready' | 'empty' | 'error'>('idle')
  const [retryKey, setRetryKey] = useState(0)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!filePath || !isImagePath(filePath)) {
      setStatus('idle')
      return
    }
    if (value.analyzed) {
      setStatus(value.faces.length > 0 ? 'ready' : 'empty')
      return
    }
    let cancelled = false
    setStatus('analyzing')
    detectBeautyFaces(filePath)
      .then((faces) => {
        if (cancelled) return
        onChangeRef.current({ faces, analyzed: true })
        setStatus(faces.length > 0 ? 'ready' : 'empty')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => { cancelled = true }
  }, [filePath, retryKey, value.analyzed, value.faces.length])

  if (!filePath || !isImagePath(filePath)) {
    return <div className="workspace-beauty-message">美颜目前支持图片素材。</div>
  }

  const disabled = status !== 'ready'
  const retry = () => {
    onChangeRef.current({ faces: [], analyzed: false })
    setRetryKey((key) => key + 1)
  }
  return (
    <div className="workspace-beauty-panel">
      <div className={`workspace-beauty-status ${status}`}>
        {status === 'analyzing' ? <LoadingIndicator /> : <ScanFace size={17} />}
        <span>
          {status === 'analyzing' && '正在识别人脸…'}
          {status === 'ready' && `已识别 ${value.faces.length} 张人脸`}
          {status === 'empty' && '未识别到清晰人脸'}
          {status === 'error' && '人脸识别没有完成'}
        </span>
        {(status === 'error' || status === 'empty') && (
          <Button variant="secondary" size="mini" onClick={retry}>{status === 'empty' ? '重新识别' : '重试'}</Button>
        )}
      </div>

      <label className="workspace-beauty-debug-toggle">
        <span>显示识别区域</span>
        <Switch checked={debug} onCheckedChange={onDebugChange} ariaLabel="显示美颜识别区域" />
      </label>
      {debug && (
        <div className="workspace-beauty-debug-legend" aria-label="识别区域颜色说明">
          <span data-color="face">脸部范围</span>
          <span data-color="eyes">眼部范围</span>
          <span data-color="mouth">嘴部保护</span>
        </div>
      )}

      <fieldset className="workspace-beauty-controls" disabled={disabled}>
        <ParamSlider label="磨皮" value={value.smoothing} min={0} max={100} onChange={(smoothing) => onChange({ smoothing })} formatValue={String} />
        <ParamSlider label="美白" value={value.whitening} min={0} max={100} onChange={(whitening) => onChange({ whitening })} formatValue={String} />
        <ParamSlider label="瘦脸" value={value.slimFace} min={0} max={100} onChange={(slimFace) => onChange({ slimFace })} formatValue={String} />
        <ParamSlider label="大眼" value={value.bigEyes} min={0} max={100} onChange={(bigEyes) => onChange({ bigEyes })} formatValue={String} />
      </fieldset>

      {(value.smoothing > 0 || value.whitening > 0 || value.slimFace > 0 || value.bigEyes > 0) && (
        <Button
          className="workspace-beauty-reset"
          variant="secondary"
          size="mini"
          icon={<RotateCcw size={13} />}
          onClick={() => onChange({ smoothing: 0, whitening: 0, slimFace: 0, bigEyes: 0 })}
        >
          重置美颜
        </Button>
      )}
    </div>
  )
}
