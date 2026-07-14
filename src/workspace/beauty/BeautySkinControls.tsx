import { ParamSlider } from '../components/ParamSlider'
import type { BeautySkinSettings } from '../shared/beautySettings'

interface Props {
  value: BeautySkinSettings
  onChange: (patch: Partial<BeautySkinSettings>) => void
}

export function BeautySkinControls({ value, onChange }: Props) {
  return <div className="workspace-beauty-controls">
    <ParamSlider label="磨皮" value={value.smoothing} min={0} max={100} onChange={(smoothing) => onChange({ smoothing })} />
    <ParamSlider label="美白" value={value.whitening} min={0} max={100} onChange={(whitening) => onChange({ whitening })} />
    <ParamSlider label="美肤" value={value.complexion} min={0} max={100} onChange={(complexion) => onChange({ complexion })} />
    <ParamSlider label="肤色冷暖" value={value.warmth} min={-100} max={100} onChange={(warmth) => onChange({ warmth })} />
    <ParamSlider label="红润" value={value.rosy} min={0} max={100} onChange={(rosy) => onChange({ rosy })} />
    <ParamSlider label="肌肤质感" value={value.texture} min={0} max={100} onChange={(texture) => onChange({ texture })} />
    <ParamSlider label="淡化法令纹" value={value.nasolabialFolds} min={0} max={100} onChange={(nasolabialFolds) => onChange({ nasolabialFolds })} />
  </div>
}
