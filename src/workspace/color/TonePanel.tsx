import { RotateCcw, Sparkles } from 'lucide-react'

import { TONE_DEFAULTS, type EditPipeline } from '../shared/editPipeline'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion, IconButton } from '../../ui'
import { exposureValue } from './colorPanelShared'

interface TonePanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

export function TonePanel({ value, modified, onChange }: TonePanelProps) {
  return (
    <Accordion
      title="影调"
      defaultOpen
      modified={modified}
      actions={
        <>
          <IconButton variant="ghost" size="mini" icon={<Sparkles size={14} />} title="自动调整" />
          <button className="workspace-acc-reset" type="button" onClick={() => onChange(TONE_DEFAULTS)} title="重置影调">
            <RotateCcw size={11} />
          </button>
        </>
      }
    >
      <ParamSlider label="曝光" value={value.exposure} min={-5} max={5} step={0.1} onChange={(exposure) => onChange({ exposure })} formatValue={exposureValue} />
      <ParamSlider label="对比度" value={value.contrast} min={-100} max={100} onChange={(contrast) => onChange({ contrast })} />
      <ParamSlider label="亮度" value={value.brightness} min={-100} max={100} onChange={(brightness) => onChange({ brightness })} />
      <ParamSlider label="高光" value={value.highlights} min={-100} max={100} onChange={(highlights) => onChange({ highlights })} />
      <ParamSlider label="阴影" value={value.shadows} min={-100} max={100} onChange={(shadows) => onChange({ shadows })} />
      <ParamSlider label="白色" value={value.whites} min={-100} max={100} onChange={(whites) => onChange({ whites })} />
      <ParamSlider label="黑色" value={value.blacks} min={-100} max={100} onChange={(blacks) => onChange({ blacks })} />
      <ParamSlider label="纹理" value={value.texture} min={-100} max={100} onChange={(texture) => onChange({ texture })} />
      <ParamSlider label="清晰度" value={value.clarity} min={-100} max={100} onChange={(clarity) => onChange({ clarity })} />
      <ParamSlider label="祛雾" value={value.dehaze} min={-100} max={100} onChange={(dehaze) => onChange({ dehaze })} />
      <ParamSlider label="鲜艳度" value={value.vibrance} min={-100} max={100} onChange={(vibrance) => onChange({ vibrance })} />
      <ParamSlider label="饱和度" value={value.saturation} min={-100} max={100} onChange={(saturation) => onChange({ saturation })} />
    </Accordion>
  )
}
