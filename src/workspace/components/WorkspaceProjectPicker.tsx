import { useState } from 'react'
import { Folder, Pencil, Plus, Trash2 } from 'lucide-react'

import { useWorkspaceMedia } from '../context/WorkspaceMediaContext'
import type { WorkspaceProject } from '../../shared/types'
import { Button, Dialog, Input, toast } from '../../ui'
import { ThumbImage } from '../../components/ThumbImage'

export function WorkspaceProjectPicker() {
  const { projects, projectLoading, openProject, deleteProject, renameProject, createProject } = useWorkspaceMedia()
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; project: WorkspaceProject } | null>(null)
  const [renameOpen, setRenameOpen] = useState(false)
  const [renameProjectId, setRenameProjectId] = useState('')
  const [renameValue, setRenameValue] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteProjectId, setDeleteProjectId] = useState('')
  const [deleteProjectName, setDeleteProjectName] = useState('')
  const [createOpen, setCreateOpen] = useState(false)
  const [createName, setCreateName] = useState('')
  const [creating, setCreating] = useState(false)

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

  async function handleCreateConfirm(): Promise<void> {
    if (creating || !createName.trim()) return
    setCreating(true)
    try {
      await createProject(createName.trim())
      setCreateOpen(false)
      setCreateName('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="workspace-project-page" onClick={closeContextMenu}>
      <header className="workspace-project-header">
        <h2>工作台项目</h2>
        <span>{projectLoading ? '加载中...' : `${projects.length} 个项目`}</span>
        <div className="workspace-project-header-actions">
          <Button variant="primary" size="compact" icon={<Plus color='white' size={14} />} onClick={() => setCreateOpen(true)}>
            新建项目
          </Button>
        </div>
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
                  <ThumbImage key={asset.id} src={asset.path} alt="" />
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
        tone="dark"
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="重命名项目"
        footer={
          <>
            <Button variant="secondary" onClick={() => setRenameOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void handleRenameConfirm()} disabled={!renameValue.trim()}>
              确认
            </Button>
          </>
        }
      >
        <div className="workspace-dialog-body">
          <Input fullWidth value={renameValue} onChange={(e) => setRenameValue(e.target.value)} placeholder="项目名称" autoFocus />
        </div>
      </Dialog>

      {/* 创建项目弹窗 */}
      <Dialog
        tone="dark"
        open={createOpen}
        onOpenChange={setCreateOpen}
        title="新建项目"
        footer={
          <>
            <Button variant="secondary" onClick={() => setCreateOpen(false)}>取消</Button>
            <Button variant="primary" onClick={() => void handleCreateConfirm()} disabled={!createName.trim() || creating}>
              {creating ? '创建中...' : '创建'}
            </Button>
          </>
        }
      >
        <div className="workspace-dialog-body">
          <Input fullWidth value={createName} onChange={(e) => setCreateName(e.target.value)} placeholder="项目名称" autoFocus />
        </div>
      </Dialog>

      {/* 删除确认弹窗 */}
      <Dialog
        tone="dark"
        open={deleteConfirmOpen}
        onOpenChange={setDeleteConfirmOpen}
        title={`删除「${deleteProjectName}」`}
        description="确定删除此项目？项目中的图片文件不会被删除，只是从工作台列表中移除。"
        footer={<><Button variant="secondary" onClick={() => setDeleteConfirmOpen(false)}>取消</Button><Button variant="danger" onClick={() => void handleDeleteConfirm()}>删除</Button></>}
      />
    </div>
  )
}
