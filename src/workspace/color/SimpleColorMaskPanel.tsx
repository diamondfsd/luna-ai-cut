import { Globe2, Loader2, ScanSearch } from 'lucide-react'
import { useState } from 'react'

import { Button, toast } from '../../ui'
import type { AutomaticSegmentationTargetId } from '../../shared/segmentationModels'
import { useWorkspaceEdit } from '../context/WorkspaceEditContext'
import { useWorkspaceMask } from '../context/WorkspaceMaskContext'
import { ColorPanel } from './ColorPanel'
import './SimpleColorMaskPanel.css'

const SUGGESTED_TARGETS: AutomaticSegmentationTargetId[] = [
  'subject',
  'ade20k-12',
  'sky',
  'building',
]

export function SimpleColorMaskPanel() {
  const edit = useWorkspaceEdit()
  const mask = useWorkspaceMask()
  const [analyzing, setAnalyzing] = useState(false)
  const selectedColor = mask.activeMask?.color ?? edit.pipeline.color

  const analyzePhoto = async (): Promise<void> => {
    if (analyzing || mask.busy) return
    setAnalyzing(true)
    mask.clearSegmentationError()
    try {
      const count = await mask.generateSuggestedMasks(SUGGESTED_TARGETS)
      if (count > 0) toast.success(`已找到 ${count} 个可调区域`)
      else toast.show('没有发现新的可调区域')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '照片区域分析失败，请重试')
    } finally {
      setAnalyzing(false)
    }
  }

  return (
    <div className="workspace-simple-color-mask-panel">
      <section className="workspace-simple-color-scope" aria-label="调色区域">
        <div className="workspace-simple-color-scope-header">
          <strong>调色区域</strong>
          <Button
            variant="secondary"
            size="mini"
            icon={analyzing || mask.busy ? <Loader2 className="spin" size={14} /> : <ScanSearch size={14} />}
            disabled={!mask.available || analyzing || mask.busy}
            onClick={() => void analyzePhoto()}
          >
            {analyzing || mask.busy ? '分析中' : '分析照片'}
          </Button>
        </div>
        <div className="workspace-simple-color-scopes">
          <Button
            variant={mask.activeMask ? 'ghost' : 'primary'}
            size="compact"
            icon={<Globe2 size={15} />}
            onClick={() => mask.setActiveLayerId(null)}
          >
            全局
          </Button>
          {edit.pipeline.colorMasks.map((layer) => (
            <Button
              key={layer.id}
              variant={mask.activeLayerId === layer.id ? 'primary' : 'ghost'}
              size="compact"
              disabled={Boolean(layer.loadError)}
              onClick={() => mask.setActiveLayerId(layer.id)}
            >
              {layer.name}
            </Button>
          ))}
        </div>
      </section>
      <div className="workspace-simple-color-controls">
        <ColorPanel
          value={selectedColor}
          onChange={(color) => mask.activeMask
            ? mask.updateActiveLayer({ color: { ...mask.activeMask.color, ...color } })
            : edit.updateWorkspacePanel({ color })}
          onActivatePipette={mask.activeMask ? undefined : () => edit.setPipetteActive(true)}
        />
      </div>
    </div>
  )
}
