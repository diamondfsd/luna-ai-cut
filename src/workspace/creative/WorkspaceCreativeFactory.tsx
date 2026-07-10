import { LayoutTemplate } from 'lucide-react'

import type { CreativeModeId } from '../components/WorkspaceModeHeader'
import { TripleStitchCreative } from './triple-stitch/TripleStitchCreative'
import './creative-factory.css'

interface WorkspaceCreativeFactoryProps {
  creativeModeId: CreativeModeId | null
}

export function WorkspaceCreativeFactory({ creativeModeId }: WorkspaceCreativeFactoryProps) {
  console.log(`[Perf ${new Date().toISOString().slice(11, 23)}] WorkspaceCreativeFactory render creativeModeId=${creativeModeId}`)
  if (creativeModeId === 'triple-stitch') {
    return <TripleStitchCreative />
  }

  return (
    <section className="workspace-creative-list-page">
      <div className="workspace-creative-list">
        <button className="workspace-creative-card workspace-creative-card--active" type="button">
          <LayoutTemplate size={22} />
          <strong>Live 三拼</strong>
          <span>将三个素材拼成 9:16 竖版内容</span>
        </button>
      </div>
    </section>
  )
}
