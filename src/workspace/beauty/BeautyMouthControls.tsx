import { ParamSlider } from '../components/ParamSlider'
import type { BeautyMouthSettings } from '../shared/beautySettings'

interface Props { value: BeautyMouthSettings; onChange: (patch: Partial<BeautyMouthSettings>) => void }

export function BeautyMouthControls({ value, onChange }: Props) {
  return <div className="workspace-beauty-controls">
    <ParamSlider label="嘴型" value={value.size} min={-100} max={100} onChange={(size) => onChange({ size })} />
    <ParamSlider label="美牙" value={value.teeth} min={0} max={100} onChange={(teeth) => onChange({ teeth })} />
  </div>
}
