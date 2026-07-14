import { ParamSlider } from '../components/ParamSlider'
import type { BeautyNoseSettings } from '../shared/beautySettings'

interface Props { value: BeautyNoseSettings; onChange: (patch: Partial<BeautyNoseSettings>) => void }

export function BeautyNoseControls({ value, onChange }: Props) {
  return <div className="workspace-beauty-controls">
    <ParamSlider label="瘦鼻" value={value.thin} min={0} max={100} onChange={(thin) => onChange({ thin })} />
    <ParamSlider label="鼻翼" value={value.alae} min={0} max={100} onChange={(alae) => onChange({ alae })} />
    <ParamSlider label="鼻子长短" value={value.length} min={-100} max={100} onChange={(length) => onChange({ length })} />
  </div>
}
