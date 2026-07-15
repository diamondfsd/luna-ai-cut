import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '../../ui'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { CREATIVE_CATALOG, type CreativeModeId } from './creativeCatalog'
import { ColorRevealCreative } from './color-reveal/ColorRevealCreative'
import { TripleStitchCreative } from './triple-stitch/TripleStitchCreative'
import './creative-factory.css'

interface WorkspaceCreativeFactoryProps {
  creativeModeId: CreativeModeId | null
  onCreativeModeChange: (modeId: CreativeModeId | null) => void
}

const CREATIVE_RENDERERS: Record<CreativeModeId, (onBack: () => void) => ReactNode> = {
  'color-reveal': (onBack) => <ColorRevealCreative onBack={onBack} />,
  'triple-stitch': (onBack) => <TripleStitchCreative onBack={onBack} />,
}

export function WorkspaceCreativeFactory({ creativeModeId, onCreativeModeChange }: WorkspaceCreativeFactoryProps) {
  const media = useWorkspaceMedia()
  console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] WorkspaceCreativeFactory render creativeModeId=${creativeModeId}`)
  if (creativeModeId) {
    return CREATIVE_RENDERERS[creativeModeId](() => onCreativeModeChange(null))
  }

  return (
    <section className="workspace-creative-list-page">
      <header className="workspace-creative-list-header">
        <Button variant="toolbar" size="compact" icon={<ArrowLeft size={15} />} onClick={media.backToProjects}>
          返回工作台列表
        </Button>
        <div>
          <h2>创意效果</h2>
          <p>选择一个效果开始制作</p>
        </div>
      </header>
      <div className="workspace-creative-list">
        {CREATIVE_CATALOG.map((item) => {
          const ItemIcon = item.icon
          return (
            <button
              key={item.id}
              className="workspace-creative-card"
              type="button"
              onClick={() => onCreativeModeChange(item.id)}
            >
              <span className={`workspace-creative-preview ${item.previewClassName}`} aria-hidden="true">
                <ItemIcon size={24} />
              </span>
              <span className="workspace-creative-card-copy">
                <strong>{item.name}</strong>
                <span>{item.description}</span>
              </span>
              <ArrowRight className="workspace-creative-card-arrow" size={17} />
            </button>
          )
        })}
      </div>
    </section>
  )
}
