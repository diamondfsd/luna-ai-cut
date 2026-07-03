import { useRef, useState } from 'react'
import { Folder, ImageIcon, Pencil, Trash2 } from 'lucide-react'

import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import { logger } from '../../lib/rendererLogger'
import type { WorkspaceProject } from '../../shared/types'
import { Button, Dialog, Input } from '../../ui'

export function WorkspaceProjectPicker() {
  const { projects, projectLoading, openProject, deleteProject, renameProject } = useWorkspaceMedia()
  const failedThumbUrlsRef = useRef(new Set<string>())
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: WorkspaceProject } | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameProjectId, setRenameProjectId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteProjectId, setDeleteProjectId] = useState('')
  const [deleteProjectName, setDeleteProjectName] = useState('')

  function handleThumbError(url: string | undefined, projectName: string): void {
    if (!url || failedThumbUrlsRef.current.has(url)) return
    failedThumbUrlsRef.current.add(url)
    logger.warn(`[WorkspaceProjectPicker] 项目缩略图加载失败`, { url: url.slice(0, 200), projectName })
  }

  function handleContextMenu(e: React.MouseEvent, project: WorkspaceProject): void {
    e.preventDefault()
    setContextMenu({ x: e.clientX, y: e.clientY, project })
  }

  function closeContextMenu(): void {
    setContextMenu(null)
  }

  function handleRenameClick(): void {
    if (!contextMenu) return
    setRenameProjectId(contextMenu.project.id)
    setRenameValue(contextMenu.project.name)
    setRenameOpen(true)
    closeContextMenu()
  }

  async function handleRenameConfirm(): Promise<void> {
    if (!renameValue.trim()) return
    await renameProject(renameProjectId, renameValue.trim())
    setRenameOpen(false)
  }

  function handleDeleteClick(): void {
    if (!contextMenu) return
    setDeleteProjectId(contextMenu.project.id)
    setDeleteProjectName(contextMenu.project.name)
    setDeleteConfirmOpen(true)
    closeContextMenu()
  }

  async function handleDeleteConfirm(): Promise<void> {
    await deleteProject(deleteProjectId)
    setDeleteConfirmOpen(false)
  }

  return (
    <div className="workspace-project-page" onClick={closeContextMenu}>
      <header className="workspace-project-header">
        <h2>工作台项目</h2>
        <span>{projectLoading ? '加载中...' : `${projects.length} 个项目`}</span>
      </header>
      <div className="workspace-project-grid">
        {projects.map((project) => (
          <button
            key={project.id}
            className="workspace-project-card"
            type="button"
            onClick={() => openProject(project)}
            onContextMenu={(e) => handleContextMenu(e, project)}
          >
            <span className="workspace-project-folder">
              <Folder size={112} strokeWidth={1.2} />
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

      {/* 右键菜单 */}
      {contextMenu && (
        <div
          className="workspace-context-menu"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          <button type="button" className="workspace-context-item" onClick={handleRenameClick}>
            <Pencil size={14} /> 重命名
          </button>
          <button type="button" className="workspace-context-item danger" onClick={handleDeleteClick}>
            <Trash2 size={14} /> 删除
          </button>
        </div>
      )}

      {/* 重命名弹窗 */}
      <Dialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="重命名项目"
        footer={
          <button type="button" className="ui-button ui-button--primary" onClick={() => void handleRenameConfirm()} disabled={!renameValue.trim()}>
            确认
          </button>
        }
      >
        <Input variant="pill" value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="项目名称" autoFocus />
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={`删除「${deleteProjectName}」`}
        description="确定删除此项目？项目中的图片文件不会被删除，只是从工作台列表中移除。"
        footer={<><Button variant="secondary" onClick={() => setDeleteConfirmOpen(false)}>取消</Button><Button variant="danger" onClick={() => void handleDeleteConfirm()}>删除</Button></>}
      />
    </div>
  )
}
