import { useCallback, useEffect, useState } from 'react'
import { Trash2 } from 'lucide-react'

import type { CustomLutFile } from '../shared/types'
import { Button, Dialog, LoadingIndicator, toast } from '../ui'
import './LutManagementDialog.css'

interface LutManagementDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function LutManagementDialog({ open, onOpenChange }: LutManagementDialogProps) {
  const [files, setFiles] = useState<CustomLutFile[]>([])
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<CustomLutFile | null>(null)
  const [deleting, setDeleting] = useState(false)

  const loadFiles = useCallback(async () => {
    setLoading(true)
    setLoadFailed(false)
    try {
      setFiles(await window.luna.listCustomLuts())
    } catch (error) {
      setFiles([])
      setLoadFailed(true)
      toast.error(error instanceof Error ? error.message : '无法读取自定义 LUT')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void loadFiles()
    else setDeleteTarget(null)
  }, [loadFiles, open])

  async function confirmDelete(): Promise<void> {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await window.luna.deleteCustomLut(deleteTarget.filePath)
      setFiles((current) => current.filter((file) => file.filePath !== deleteTarget.filePath))
      setDeleteTarget(null)
      toast.success('LUT 已删除')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : '无法删除这个 LUT')
    } finally {
      setDeleting(false)
    }
  }

  return <>
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="管理自定义 LUT"
      className="lut-management-dialog"
      footer={<Button variant="primary" onClick={() => onOpenChange(false)}>完成</Button>}
    >
      <div className="ui-dialog-body lut-management-body">
        {loading ? <LoadingIndicator label="正在读取 LUT" /> : loadFailed ? (
          <div className="lut-management-state">
            <span>暂时无法读取自定义 LUT</span>
            <Button variant="secondary" size="compact" onClick={() => void loadFiles()}>重试</Button>
          </div>
        ) : files.length === 0 ? (
          <div className="lut-management-state">当前目录中没有自定义 LUT</div>
        ) : (
          <div className="lut-management-list" aria-label={`自定义 LUT，共 ${files.length} 个`}>
            {files.map((file) => <article className="lut-management-item" key={file.filePath}>
              <div>
                <strong title={file.fileName}>{file.fileName}</strong>
                <span>{file.relativeDirectory || 'LUT 根目录'}</span>
              </div>
              <Button
                variant="danger"
                size="mini"
                icon={<Trash2 size={13} />}
                onClick={() => setDeleteTarget(file)}
              >
                删除
              </Button>
            </article>)}
          </div>
        )}
      </div>
    </Dialog>
    <Dialog
      open={Boolean(deleteTarget)}
      onOpenChange={(next) => { if (!next && !deleting) setDeleteTarget(null) }}
      title="删除 LUT"
      description={deleteTarget ? `确定删除“${deleteTarget.fileName}”吗？此操作无法撤销。` : undefined}
      footer={<>
        <Button variant="secondary" disabled={deleting} onClick={() => setDeleteTarget(null)}>取消</Button>
        <Button variant="danger" disabled={deleting} onClick={() => void confirmDelete()}>{deleting ? '正在删除' : '确认删除'}</Button>
      </>}
    />
  </>
}
