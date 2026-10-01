import { useState } from 'react'
import { ChevronRight, Film } from 'lucide-react'

import { DirectorLabView } from '../components/DirectorLabView'
import '../styles/lab.css'

type LabFeature = 'director'

export function LabPage() {
  const [feature, setFeature] = useState<LabFeature | null>(null)

  if (feature === 'director') {
    return <DirectorLabView onBack={() => setFeature(null)} />
  }

  return (
    <div className="lab-page lab-menu-page">
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
  )
}
