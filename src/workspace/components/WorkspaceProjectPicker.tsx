import { Folder, ImageIcon } from 'lucide-react'

import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'

export function WorkspaceProjectPicker() {
  const { projects, projectLoading, openProject } = useWorkspaceMedia()

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
                  asset.thumbnailUrl ? <img key={asset.id} src={asset.thumbnailUrl} alt="" /> : <span key={asset.id}><ImageIcon size={16} /></span>
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
