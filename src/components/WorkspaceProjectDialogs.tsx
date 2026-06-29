import { Sparkles } from 'lucide-react'

import type { WorkspaceProject } from '../shared/types'
import { Button, Dialog, Input, Select } from '../ui'

interface CreateWorkspaceProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projectName: string
  onProjectNameChange: (value: string) => void
  canCreate: boolean
  busy: boolean
  onConfirm: () => void
}

interface AddToWorkspaceProjectDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  projects: WorkspaceProject[]
  selectedProjectId: string
  onSelectedProjectIdChange: (value: string) => void
  busy: boolean
  onConfirm: () => void
}

export function CreateWorkspaceProjectDialog({
  open,
  onOpenChange,
  projectName,
  onProjectNameChange,
  canCreate,
  busy,
  onConfirm,
}: CreateWorkspaceProjectDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="创建工作台项目"
      description="项目会保存在本地资源中，后续可以继续编辑。"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={!canCreate || busy} icon={<Sparkles size={14} />} onClick={onConfirm}>
            创建并编辑
          </Button>
        </>
      }
    >
      <div className="workspace-dialog-body">
        <Input
          fullWidth
          value={projectName}
          placeholder="项目名称"
          onChange={(event) => onProjectNameChange(event.target.value)}
        />
      </div>
    </Dialog>
  )
}

export function AddToWorkspaceProjectDialog({
  open,
  onOpenChange,
  projects,
  selectedProjectId,
  onSelectedProjectIdChange,
  busy,
  onConfirm,
}: AddToWorkspaceProjectDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="添加到已有项目"
      description="选择一个项目，把当前选中的图片加入进去。"
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="primary" disabled={!selectedProjectId || busy} onClick={onConfirm}>
            添加并编辑
          </Button>
        </>
      }
    >
      <div className="workspace-dialog-body">
        {projects.length > 0 ? (
          <Select
            fullWidth
            value={selectedProjectId}
            options={projects.map((project) => ({ value: project.id, label: project.name }))}
            onValueChange={onSelectedProjectIdChange}
          />
        ) : (
          <div className="workspace-dialog-empty">暂无项目，请先创建项目。</div>
        )}
      </div>
    </Dialog>
  )
}
