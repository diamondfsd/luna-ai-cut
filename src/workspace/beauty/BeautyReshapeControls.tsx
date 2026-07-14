import { ParamSlider } from '../components/ParamSlider'
import type { BeautyReshapeSettings } from '../shared/beautySettings'

interface Props { value: BeautyReshapeSettings; onChange: (patch: Partial<BeautyReshapeSettings>) => void }

export function BeautyReshapeControls({ value, onChange }: Props) {
  return <div className="workspace-beauty-controls">
    <ParamSlider label="瘦脸" value={value.slimFace} min={0} max={100} onChange={(slimFace) => onChange({ slimFace })} />
    <ParamSlider label="削脸" value={value.faceShave} min={0} max={100} onChange={(faceShave) => onChange({ faceShave })} />
    <ParamSlider label="小脸" value={value.faceNarrow} min={0} max={100} onChange={(faceNarrow) => onChange({ faceNarrow })} />
    <ParamSlider label="下巴" value={value.chin} min={-100} max={100} onChange={(chin) => onChange({ chin })} />
    <ParamSlider label="额头" value={value.forehead} min={-100} max={100} onChange={(forehead) => onChange({ forehead })} />
  </div>
}
