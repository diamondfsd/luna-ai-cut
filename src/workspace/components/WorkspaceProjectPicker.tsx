import { useRef } from 'react'
import { Folder, ImageIcon } from 'lucide-react'

import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { logger } from '../../lib/rendererLogger'

export function WorkspaceProjectPicker() {
  const { projects, projectLoading, openProject } = useWorkspaceMedia()
  // 记录加载失败的缩略图 URL 避免重复 log
  const failedThumbUrlsRef = useRef(new Set<string>())

  function handleThumbError(url: string | undefined, projectName: string): void {
    if (!url || failedThumbUrlsRef.current.has(url)) return
    failedThumbUrlsRef.current.add(url)
    logger.warn(`[WorkspaceProjectPicker] 项目缩略图加载失败`, { url: url.slice(0, 200), projectName })
  }

  return (
    <div className="workspace-project-page">
      <header className="workspace-project-header">
        <h2>工作台项目</h2>
        <span>{projectLoading ? '加载中...' : `${projects.length} 个项目`}</span>
      </header>
      <div className="workspace-project-grid">
        {projects.map((project) => (
          <button key={project.id} className="workspace-project-card" type="button" onClick={() => openProject(project)}>
            <span className="workspace-project-folder">
              <Folder size={72} strokeWidth={1.5} />
              <span className="workspace-project-previews">
                {project.assets.slice(0, 4).map((asset: any) => (
                  asset.thumbnailUrl ? <img key={asset.id} src={asset.thumbnailUrl} alt="" onError={() => handleThumbError(asset.thumbnailUrl, project.name)} /> : <span key={asset.id}><ImageIcon size={16} /></span>
                ))}
              </span>
            </span>
            <span className="workspace-project-name">{project.name}</span>
          </button>
        ))}
        {!projectLoading && projects.length === 0 && (
          <div className="workspace-project-empty">在本地资源中多选图片后创建工作台项目。</div>
        )}
      </div>
    </div>
  )
}
