import { RotateCcw } from 'lucide-react'

import { CURVE_DEFAULTS, type CurvePoint, type EditPipeline, type ToneCurveChannel } from '../shared/editPipeline'
import { EDIT_PARAMETER_RANGES, sliderRange } from '../shared/editParameterRanges'
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
  const activePoints = value.curve.points[activeCurveChannel]

  function updateCurve(channel: ToneCurveChannel, points: CurvePoint[]): void {
    onChange({ curve: { ...value.curve, points: { ...value.curve.points, [channel]: points } } })
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
      <CurvePreview points={activePoints} onChange={(points) => updateCurve(activeCurveChannel, points)} />
      <ParamSlider label="输入黑点" value={value.levelsBlack} {...sliderRange(EDIT_PARAMETER_RANGES.levels.black)} onChange={(levelsBlack) => onChange({ levelsBlack })} />
      <ParamSlider label="中间调" value={value.levelsGray} {...sliderRange(EDIT_PARAMETER_RANGES.levels.gray)} onChange={(levelsGray) => onChange({ levelsGray })} />
      <ParamSlider label="输入白点" value={value.levelsWhite} {...sliderRange(EDIT_PARAMETER_RANGES.levels.white)} onChange={(levelsWhite) => onChange({ levelsWhite })} />
    </Accordion>
  )
}
