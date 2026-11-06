import { useState } from 'react'
import { ChevronRight, Film, Globe2 } from 'lucide-react'

import { DirectorLabView } from '../components/DirectorLabView'
import { PanoramaStitchingLabView } from '../components/PanoramaStitchingLabView'
import '../styles/lab.css'

type LabFeature = 'director' | 'panorama'

interface LabPageProps {
  pageActive: boolean
}

export function LabPage({ pageActive }: LabPageProps) {
  const [feature, setFeature] = useState<LabFeature | null>(null)

  return (
    <>
      <div
        className="lab-page lab-menu-page"
        style={{ display: feature ? 'none' : undefined }}
      >
        <div className="lab-menu-shell">
          <header className="lab-menu-header">
            <div>
              <span className="lab-eyebrow">LAB</span>
              <h1>实验室</h1>
            </div>
          </header>
          <section className="lab-feature-grid" aria-label="实验功能">
            <button
              className="lab-feature-card"
              type="button"
              onClick={() => setFeature('panorama')}
            >
              <span className="lab-feature-icon"><Globe2 size={20} /></span>
              <span className="lab-feature-copy">
                <strong>360 全景合成</strong>
                <small>读取相机最近 32 张照片并生成全景图</small>
              </span>
              <ChevronRight className="lab-feature-action" size={18} />
            </button>
            <button
              className="lab-feature-card"
              type="button"
              onClick={() => setFeature('director')}
            >
              <span className="lab-feature-icon"><Film size={20} /></span>
              <span className="lab-feature-copy">
                <strong>导演计划</strong>
                <small>自动发现手机，查看计划、镜头与素材</small>
              </span>
              <ChevronRight className="lab-feature-action" size={18} />
            </button>
          </section>
        </div>
      </div>
      <div hidden={feature !== 'director'}>
        <DirectorLabView
          active={pageActive && feature === 'director'}
          onBack={() => setFeature(null)}
        />
      </div>
      <div hidden={feature !== 'panorama'}>
        <PanoramaStitchingLabView
          active={pageActive && feature === 'panorama'}
          onBack={() => setFeature(null)}
        />
      </div>
    </>
  )
}
