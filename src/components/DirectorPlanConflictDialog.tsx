import { useState } from 'react'
import type { DirectorPlanConflict } from '../hooks/useDirectorPlanSync'
import { directorPlanConflictDetails, directorPlanHasSameShots } from '../lib/directorPlanSync'
import { Button, Dialog, toast } from '../ui'
import './DirectorPlanConflictDialog.css'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  conflicts: DirectorPlanConflict[]
  resolvingPlanId: string | null
  onResolve: (planId: string, source: 'remote' | 'local', reviewed: DirectorPlanConflict) => Promise<void>
}

export function DirectorPlanConflictDialog({ open, onOpenChange, conflicts, resolvingPlanId, onResolve }: Props) {
  const [choice, setChoice] = useState<{ conflict: DirectorPlanConflict; source: 'remote' | 'local' } | null>(null)
  const selected = conflicts.some((conflict) => conflict.remote.id === choice?.conflict.remote.id)
    ? choice?.conflict : null

  async function confirm(): Promise<void> {
    if (!choice) return
    try {
      await onResolve(choice.conflict.remote.id, choice.source, choice.conflict)
      setChoice(null)
      toast.success('冲突已解决')
    } catch (error) {
      setChoice(null)
      toast.error(error instanceof Error ? error.message : '处理失败，请重试')
    }
  }

  return <Dialog
    open={open}
    onOpenChange={(next) => {
      if (resolvingPlanId) return
      setChoice(null)
      onOpenChange(next)
    }}
    title="处理同步冲突"
    description="更新电脑副本前会备份原内容，不删除素材文件。"
    className="director-conflict-dialog"
    showCloseButton={!resolvingPlanId}
    footer={selected ? <>
      <Button disabled={resolvingPlanId !== null} onClick={() => setChoice(null)}>返回</Button>
      <Button variant="primary" disabled={resolvingPlanId !== null} onClick={() => void confirm()}>
        {resolvingPlanId ? '处理中' : choice?.source === 'remote' ? '确认采用手机版本' : '确认采用电脑版本'}
      </Button>
    </> : <Button onClick={() => onOpenChange(false)}>关闭</Button>}
  >
    <div className="director-conflict-list">
      {(selected ? [selected] : conflicts).map(({ remote, local }) => {
        const sameShots = directorPlanHasSameShots(remote, local)
        return <section key={remote.id} className="director-conflict-plan">
          <strong>{remote.title}</strong>
          <div className="director-conflict-versions">
            {[{ label: '手机', plan: remote }, { label: '电脑', plan: local }].map(({ label, plan }) =>
              <div key={label}>
                <span>{label}</span><strong>{plan.title}</strong>
                <span>{plan.shots.length} 个镜头</span>
                <time>{new Date(plan.updated_at).toLocaleString('zh-CN')}</time>
              </div>)}
          </div>
          <div className="director-conflict-differences">
            {directorPlanConflictDetails(remote, local).map((difference, index) => <div key={index}>
              <span>{difference.label}</span>
              <p><small>手机</small>{difference.remote || '未填写'}</p>
              <p><small>电脑</small>{difference.local || '未填写'}</p>
            </div>)}
          </div>
          {!selected && <div className="director-conflict-actions">
            <Button size="compact" onClick={() => setChoice({ conflict: { remote, local }, source: 'remote' })}>采用手机</Button>
            <Button size="compact" disabled={!sameShots} onClick={() => setChoice({ conflict: { remote, local }, source: 'local' })}>采用电脑</Button>
          </div>}
          {!sameShots && <p>两端镜头不同，不能用电脑副本覆盖手机镜头和素材。</p>}
          {selected && <p>{choice?.source === 'remote' ? '手机内容将替换电脑计划内容。' : '电脑计划内容将写入手机，保留手机现有素材。'}</p>}
        </section>
      })}
      {conflicts.length === 0 && <p>没有待处理冲突</p>}
    </div>
  </Dialog>
}
