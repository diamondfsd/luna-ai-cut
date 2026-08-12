import { useState } from 'react'
import { Loader2, RotateCcw } from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@freecut/components/ui/dialog'
import { resetEditingProjectToInitial } from '../reset-editing-project'

interface AiEditingResetDialogProps {
  open: boolean
  projectId: string | null
  onOpenChange(open: boolean): void
  onResetConversation(): Promise<void>
}

export function AiEditingResetDialog({
  open,
  projectId,
  onOpenChange,
  onResetConversation,
}: AiEditingResetDialogProps) {
  const [resetting, setResetting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const reset = async () => {
    if (!projectId || resetting) return
    setResetting(true)
    setError(null)
    try {
      await resetEditingProjectToInitial(projectId)
      await onResetConversation()
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '项目未能恢复到初始状态。')
    } finally {
      setResetting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!resetting) onOpenChange(next) }}>
      <DialogContent className="freecut-app dark max-w-md">
        <DialogHeader>
          <DialogTitle>重置测试项目</DialogTitle>
          <DialogDescription>
            时间轴和剪辑源码将恢复到项目首次初始化时的状态。已导入素材、素材分析和历史会话会保留，当前对话将归档并开始新会话。
          </DialogDescription>
        </DialogHeader>
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={resetting}>
            取消
          </Button>
          <Button type="button" variant="destructive" onClick={() => void reset()} disabled={!projectId || resetting}>
            {resetting ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            {resetting ? '正在重置' : '恢复初始状态'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
