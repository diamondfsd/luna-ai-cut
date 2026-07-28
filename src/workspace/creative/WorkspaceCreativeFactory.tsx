import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '../../ui'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { CREATIVE_CATALOG, type CreativeModeId } from './creativeCatalog'
import { ColorRevealCreative } from './color-reveal/ColorRevealCreative'
import { OnlyYourColorCreative } from './only-your-color/OnlyYourColorCreative'
import { PixelStretchCreative } from './pixel-stretch/PixelStretchCreative'
import { TripleStitchCreative } from './triple-stitch/TripleStitchCreative'
import './creative-factory.css'

interface WorkspaceCreativeFactoryProps {
  creativeModeId: CreativeModeId | null
  onCreativeModeChange: (modeId: CreativeModeId | null) => void
}

const CREATIVE_RENDERERS: Record<CreativeModeId, (onBack: () => void) => ReactNode> = {
  'color-reveal': (onBack) => <ColorRevealCreative onBack={onBack} />,
  'only-your-color': (onBack) => <OnlyYourColorCreative onBack={onBack} />,
  'pixel-stretch': (onBack) => <PixelStretchCreative onBack={onBack} />,
  'triple-stitch': (onBack) => <TripleStitchCreative onBack={onBack} />,
}

function CreativeCover({ id }: { id: CreativeModeId }) {
  if (id === 'only-your-color') return <span className="creative-cover-only-color">
    <span className="creative-cover-city"><i /><i /><i /><i /></span>
    <span className="creative-cover-street" />
    <span className="creative-cover-person-back"><i /></span>
  </span>
  if (id === 'pixel-stretch') return <span className="pixel-stretch-cover-scene">
    <span className="pixel-stretch-cover-sky" />
    <span className="pixel-stretch-cover-ridge" />
    <span className="pixel-stretch-cover-ground" />
    <span className="pixel-stretch-cover-flow"><i /><i /><i /><i /><i /></span>
    <span className="pixel-stretch-cover-subject"><i /></span>
  </span>
  if (id === 'color-reveal') return <span className="creative-cover-reveal">
    <span className="creative-cover-reveal-sky" />
    <span className="creative-cover-reveal-hill" />
    <span className="creative-cover-reveal-water" />
    <span className="creative-cover-reveal-mono" />
    <span className="creative-cover-reveal-line" />
  </span>
  return <span className="creative-cover-triple">
    <span className="creative-cover-triple-top"><i /></span>
    <span className="creative-cover-triple-middle"><i /></span>
    <span className="creative-cover-triple-bottom"><i /></span>
  </span>
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
          return (
            <button
              key={item.id}
              className="workspace-creative-card"
              type="button"
              onClick={() => onCreativeModeChange(item.id)}
            >
              <span className={`workspace-creative-preview ${item.previewClassName}`} aria-hidden="true">
                <CreativeCover id={item.id} />
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
