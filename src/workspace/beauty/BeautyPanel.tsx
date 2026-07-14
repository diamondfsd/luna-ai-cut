import { RotateCcw, ScanFace } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { Button, LoadingIndicator, PillTabs, Switch } from '../../ui'
import { isImagePath } from '../../lib/fileUtils'
import type { BeautySettings } from '../shared/editPipeline'
import { DEFAULT_BEAUTY_SETTINGS, isBeautyModified } from '../shared/beautySettings'
import { BEAUTY_ANALYSIS_VERSION, detectBeautyAnalysis } from './beautyAnalysis'
import { BeautyEyeControls } from './BeautyEyeControls'
import { BeautyMakeupControls } from './BeautyMakeupControls'
import { BeautyMouthControls } from './BeautyMouthControls'
import { BeautyNoseControls } from './BeautyNoseControls'
import { BeautyReshapeControls } from './BeautyReshapeControls'
import { BeautySkinControls } from './BeautySkinControls'
import '../../styles/workspace-beauty.css'

interface BeautyPanelProps {
  value: BeautySettings
  filePath?: string
  onChange: (patch: Partial<BeautySettings>) => void
  debug: boolean
  onDebugChange: (value: boolean) => void
}

export function BeautyPanel({ value, filePath, onChange, debug, onDebugChange }: BeautyPanelProps) {
  const [tab, setTab] = useState('skin')
  const [status, setStatus] = useState<'idle' | 'analyzing' | 'ready' | 'empty' | 'error'>('idle')
  const [retryKey, setRetryKey] = useState(0)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!filePath || !isImagePath(filePath)) {
      setStatus('idle')
      return
    }
    if (value.analyzed && value.analysisVersion >= BEAUTY_ANALYSIS_VERSION) {
      setStatus(value.faces.length > 0 || Boolean(value.skinMask) ? 'ready' : 'empty')
      return
    }
    let cancelled = false
    setStatus('analyzing')
    detectBeautyAnalysis(filePath)
      .then((analysis) => {
        if (cancelled) return
        onChangeRef.current({ ...analysis, analyzed: true })
        setStatus(analysis.faces.length > 0 || Boolean(analysis.skinMask) ? 'ready' : 'empty')
      })
      .catch(() => {
        if (!cancelled) setStatus('error')
      })
    return () => { cancelled = true }
  }, [filePath, retryKey, value.analysisVersion, value.analyzed, value.faces.length, value.skinMask])

  if (!filePath || !isImagePath(filePath)) {
    return <div className="workspace-beauty-message">美颜目前支持图片素材。</div>
  }

  const disabled = status !== 'ready'
  const retry = () => {
    onChangeRef.current({ faces: [], skinMask: '', skinMaskWidth: 0, skinMaskHeight: 0, analysisVersion: 0, analyzed: false })
    setRetryKey((key) => key + 1)
  }
  return (
    <div className="workspace-beauty-panel">
      <div className={`workspace-beauty-status ${status}`}>
        {status === 'analyzing' ? <LoadingIndicator /> : <ScanFace size={17} />}
        <span>
          {status === 'analyzing' && '正在识别皮肤区域…'}
          {status === 'ready' && '已识别皮肤区域'}
          {status === 'empty' && '未识别到清晰皮肤区域'}
          {status === 'error' && '皮肤区域识别没有完成'}
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
          <span data-color="skin">身体皮肤</span>
          <span data-color="face">脸部范围</span>
          <span data-color="eyes">眼部范围</span>
          <span data-color="mouth">嘴部保护</span>
        </div>
      )}

      <PillTabs
        value={tab}
        onValueChange={setTab}
        className="workspace-beauty-tabs"
        items={[
          { value: 'skin', label: '肤质' }, { value: 'reshape', label: '脸型' },
          { value: 'eyes', label: '眼部' }, { value: 'nose', label: '鼻部' },
          { value: 'mouth', label: '嘴部' }, { value: 'makeup', label: '美妆' },
        ]}
      />

      <fieldset className="workspace-beauty-control-fieldset" disabled={disabled}>
        {tab === 'skin' && <BeautySkinControls value={value.skin} onChange={(patch) => onChange({ skin: { ...value.skin, ...patch } })} />}
        {tab === 'reshape' && <BeautyReshapeControls value={value.reshape} onChange={(patch) => onChange({ reshape: { ...value.reshape, ...patch } })} />}
        {tab === 'eyes' && <BeautyEyeControls value={value.eyes} onChange={(patch) => onChange({ eyes: { ...value.eyes, ...patch } })} />}
        {tab === 'nose' && <BeautyNoseControls value={value.nose} onChange={(patch) => onChange({ nose: { ...value.nose, ...patch } })} />}
        {tab === 'mouth' && <BeautyMouthControls value={value.mouth} onChange={(patch) => onChange({ mouth: { ...value.mouth, ...patch } })} />}
        {tab === 'makeup' && <BeautyMakeupControls value={value.makeup} onChange={(patch) => onChange({ makeup: { ...value.makeup, ...patch } })} />}
      </fieldset>

      {isBeautyModified(value) && (
        <Button
          className="workspace-beauty-reset"
          variant="secondary"
          size="mini"
          icon={<RotateCcw size={13} />}
          onClick={() => onChange({
            skin: DEFAULT_BEAUTY_SETTINGS.skin,
            reshape: DEFAULT_BEAUTY_SETTINGS.reshape,
            eyes: DEFAULT_BEAUTY_SETTINGS.eyes,
            nose: DEFAULT_BEAUTY_SETTINGS.nose,
            mouth: DEFAULT_BEAUTY_SETTINGS.mouth,
            makeup: DEFAULT_BEAUTY_SETTINGS.makeup,
          })}
        >
          重置美颜
        </Button>
      )}
    </div>
  )
}
