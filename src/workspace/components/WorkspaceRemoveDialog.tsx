import { Button, Dialog } from '../../ui'

interface WorkspaceRemoveDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  selectedCount: number
  activeName: string
  onConfirm: () => void
}

export function WorkspaceRemoveDialog({
  open,
  onOpenChange,
  selectedCount,
  activeName,
  onConfirm,
}: WorkspaceRemoveDialogProps) {
  const multiple = selectedCount > 1

  return (
    <Dialog
      open={open}
      tone="dark"
      onOpenChange={onOpenChange}
      title={multiple ? `移除 ${selectedCount} 个素材` : '移除此素材'}
      description={
        multiple
          ? `确定从工作台移除这 ${selectedCount} 个素材？不会删除文件，只会从列表中移除。`
          : `确定从工作台移除「${activeName}」？不会删除文件，只会从列表中移除。`
      }
      footer={
        <>
          <Button variant="secondary" size="compact" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="danger" size="compact" onClick={onConfirm}>移除</Button>
        </>
      }
    />
  )
}
