import { ArrowLeft, ArrowRight } from 'lucide-react'
import type { ReactNode } from 'react'

import { Button } from '../../ui'
import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { CREATIVE_CATALOG, getCreativeCatalogItem, type CreativeModeId, type CreativeModuleProps } from './creativeCatalog'
import { ColorRevealCreative } from './color-reveal/ColorRevealCreative'
import { OnlyYourColorCreative } from './only-your-color/OnlyYourColorCreative'
import { PixelStretchCreative } from './pixel-stretch/PixelStretchCreative'
import { TripleStitchCreative } from './triple-stitch/TripleStitchCreative'
import './creative-factory.css'

interface WorkspaceCreativeFactoryProps {
  creativeModeId: CreativeModeId | null
  onCreativeModeChange: (modeId: CreativeModeId | null) => void
  onAddMedia: () => void
  onImportLocal: () => void
}

const CREATIVE_RENDERERS: Record<CreativeModeId, (props: CreativeModuleProps) => ReactNode> = {
  'color-reveal': (props) => <ColorRevealCreative {...props} />,
  'only-your-color': (props) => <OnlyYourColorCreative {...props} />,
  'pixel-stretch': (props) => <PixelStretchCreative {...props} />,
  'triple-stitch': (props) => <TripleStitchCreative {...props} />,
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

export function WorkspaceCreativeFactory({ creativeModeId, onCreativeModeChange, onAddMedia, onImportLocal }: WorkspaceCreativeFactoryProps) {
  const media = useWorkspaceMedia()
  console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] WorkspaceCreativeFactory render creativeModeId=${creativeModeId}`)
  if (creativeModeId) {
    return CREATIVE_RENDERERS[creativeModeId]({
      onBack: () => onCreativeModeChange(null),
      onAddMedia,
      onImportLocal,
      supportedMediaKinds: getCreativeCatalogItem(creativeModeId)?.supportedMediaKinds,
    })
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
