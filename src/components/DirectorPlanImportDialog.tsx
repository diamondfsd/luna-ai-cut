import { useRef, useState } from 'react'
import { FileUp } from 'lucide-react'
import type { DirectorLanPlanSummary } from '../shared/types'
import { Alert, Button, Dialog } from '../ui'
import './DirectorPlanImportDialog.css'

interface DirectorPlanImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImported: (plan: DirectorLanPlanSummary) => void
}

export function DirectorPlanImportDialog({ open, onOpenChange, onImported }: DirectorPlanImportDialogProps) {
  const [text, setText] = useState('')
  const [importing, setImporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const busy = useRef(false)

  async function importPlan(fromFile: boolean): Promise<void> {
    if (busy.current || (!fromFile && !text.trim())) return
    busy.current = true
    setImporting(true)
    setError(null)
    try {
      const plan = fromFile
        ? await window.luna.directorLab.importPlan()
        : await window.luna.directorLab.importPlanText(text)
      if (!plan) return
      onImported(plan)
      setText('')
      onOpenChange(false)
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : '导入计划失败')
    } finally {
      busy.current = false
      setImporting(false)
    }
  }

  return <Dialog open={open} title="导入导演计划" className="lab-plan-import-dialog"
    onOpenChange={(next) => { if (!busy.current) onOpenChange(next) }}
    showCloseButton={!importing} closeOnMaskClick={!importing}
    footer={<>
      <Button variant="secondary" size="compact" icon={<FileUp size={15} />} disabled={importing}
        onClick={() => void importPlan(true)}>选择文件</Button>
      <Button variant="secondary" size="compact" disabled={importing} onClick={() => onOpenChange(false)}>取消</Button>
      <Button variant="primary" size="compact" disabled={importing || !text.trim()}
        onClick={() => void importPlan(false)}>{importing ? '导入中' : '导入文本'}</Button>
    </>}>
    <textarea className="ui-input ui-input-compact lab-plan-import-text" aria-label="计划文本" autoFocus
      value={text} disabled={importing} maxLength={512 * 1024}
      placeholder={'# 计划名称\n\n## 01 镜头名称\n画面说明：\n建议时长：5 秒\n运镜说明：'}
      onChange={(event) => { setText(event.target.value); setError(null) }} />
    {error && <div className="lab-plan-import-error" role="alert"><Alert variant="error" message={error} /></div>}
  </Dialog>
}
