import { Copy, Trash2 } from 'lucide-react'
import { useEffect, useState } from 'react'

import { Button, Switch } from '../../ui'
import { ParamSlider } from '../components/ParamSlider'
import type { ColorMaskComponent } from '../shared/editPipeline'

interface Props {
  component: ColorMaskComponent
  busy: boolean
  onChange: (component: ColorMaskComponent) => Promise<void>
  onDuplicate: () => Promise<void>
  onRemove: () => Promise<void>
}

export function MaskComponentEditor({ component, busy, onChange, onDuplicate, onRemove }: Props) {
  const [draft, setDraft] = useState(component)

  useEffect(() => setDraft(component), [component])

  function patch(next: Partial<ColorMaskComponent>): ColorMaskComponent {
    const updated = { ...draft, ...next } as ColorMaskComponent
    setDraft(updated)
    return updated
  }

  return (
    <div className="workspace-mask-component-editor">
      {draft.type !== 'raster' && draft.type !== 'linear-gradient' && (
        <>
          <ParamSlider
            label="组件羽化"
            value={Math.round(draft.feather * 100)}
            min={0}
            max={100}
            onChange={(feather) => patch({ feather: feather / 100 })}
            onCommit={(feather) => void onChange(patch({ feather: feather / 100 }))}
            formatValue={(value) => `${Math.round(value)}%`}
          />
          <ParamSlider
            label="旋转"
            value={Math.round(draft.rotation)}
            min={0}
            max={359}
            onChange={(rotation) => patch({ rotation })}
            onCommit={(rotation) => void onChange(patch({ rotation }))}
            formatValue={(value) => `${Math.round(value)}°`}
          />
        </>
      )}
      <label className="workspace-mask-setting-row">
        <strong>启用组件</strong>
        <Switch ariaLabel="启用组件" checked={draft.enabled} disabled={busy} onCheckedChange={(enabled) => void onChange(patch({ enabled }))} />
      </label>
      <div className="workspace-mask-component-actions">
        <Button size="mini" variant="secondary" icon={<Copy size={14} />} disabled={busy} onClick={() => void onDuplicate()}>复制</Button>
        <Button size="mini" variant="secondary" disabled={busy} onClick={() => void onChange(patch({ inverted: !draft.inverted }))}>反相</Button>
        <Button size="mini" variant="danger" icon={<Trash2 size={14} />} disabled={busy} onClick={() => void onRemove()}>删除</Button>
      </div>
    </div>
  )
}
