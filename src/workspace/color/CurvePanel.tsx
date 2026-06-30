import { RotateCcw } from 'lucide-react'

import { CURVE_DEFAULTS, type EditPipeline, type ToneCurveBandAdjust, type ToneCurveChannel } from '../shared/editPipeline'
import { ParamSlider } from '../components/ParamSlider'
import { Accordion, ButtonGroup } from '../../ui'
import { CURVE_CHANNELS, CurvePreview } from './colorPanelShared'

interface CurvePanelProps {
  value: EditPipeline['color']
  modified: boolean
  onChange: (patch: Partial<EditPipeline['color']>) => void
}

export function CurvePanel({ value, modified, onChange }: CurvePanelProps) {
  const activeCurveChannel = value.curve.activeChannel
  const activeCurve = value.curve.channels[activeCurveChannel]

  function updateCurve(channel: ToneCurveChannel, patch: Partial<ToneCurveBandAdjust>): void {
    onChange({ curve: { ...value.curve, channels: { ...value.curve.channels, [channel]: { ...value.curve.channels[channel], ...patch } } } })
  }

  return (
    <Accordion
      title="曲线"
      modified={modified}
      actions={
        <button className="workspace-acc-reset" type="button" onClick={() => onChange(CURVE_DEFAULTS)} title="重置曲线">
          <RotateCcw size={11} />
        </button>
      }
    >
      <ButtonGroup
        options={CURVE_CHANNELS.map((c) => ({ value: c.key, label: c.label }))}
        value={activeCurveChannel}
        onChange={(activeChannel) => onChange({ curve: { ...value.curve, activeChannel: activeChannel as ToneCurveChannel } })}
      />
      <CurvePreview curve={activeCurve} onChange={(patch) => updateCurve(activeCurveChannel, patch)} />
      <ParamSlider label="高光" value={activeCurve.highlights} min={-100} max={100} onChange={(highlights) => updateCurve(activeCurveChannel, { highlights })} />
      <ParamSlider label="亮调" value={activeCurve.lights} min={-100} max={100} onChange={(lights) => updateCurve(activeCurveChannel, { lights })} />
      <ParamSlider label="暗调" value={activeCurve.darks} min={-100} max={100} onChange={(darks) => updateCurve(activeCurveChannel, { darks })} />
      <ParamSlider label="阴影" value={activeCurve.shadows} min={-100} max={100} onChange={(shadows) => updateCurve(activeCurveChannel, { shadows })} />
    </Accordion>
  )
}
