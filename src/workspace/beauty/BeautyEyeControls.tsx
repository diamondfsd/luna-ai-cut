import { ParamSlider } from '../components/ParamSlider'
import type { BeautyEyeSettings } from '../shared/beautySettings'

interface Props { value: BeautyEyeSettings; onChange: (patch: Partial<BeautyEyeSettings>) => void }

export function BeautyEyeControls({ value, onChange }: Props) {
  return <div className="workspace-beauty-controls">
    <ParamSlider label="大眼" value={value.bigEyes} min={0} max={100} onChange={(bigEyes) => onChange({ bigEyes })} />
    <ParamSlider label="眼距" value={value.distance} min={-100} max={100} onChange={(distance) => onChange({ distance })} />
    <ParamSlider label="眼角" value={value.corner} min={-100} max={100} onChange={(corner) => onChange({ corner })} />
    <ParamSlider label="卧蚕" value={value.furrows} min={0} max={100} onChange={(furrows) => onChange({ furrows })} />
    <ParamSlider label="淡化眼袋" value={value.bags} min={0} max={100} onChange={(bags) => onChange({ bags })} />
    <ParamSlider label="亮眼" value={value.bright} min={0} max={100} onChange={(bright) => onChange({ bright })} />
  </div>
}
