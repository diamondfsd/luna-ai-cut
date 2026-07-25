import { useEffect, useMemo, useState } from 'react'
import { Trash2, UserRound } from 'lucide-react'

import type { AiFaceGroup, AiSelectionItem } from '../shared/types'
import { Button, Dialog } from '../ui'
import { AiFaceGroupCover } from './AiPeopleGroupCover'
import './AiPersonMergeDialog.css'

interface AiPersonMergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: AiFaceGroup | null
  groups: AiFaceGroup[]
  items: AiSelectionItem[]
  busy: boolean
  onMerge: (sourceGroupId: string) => Promise<boolean>
  onUnmerge: (memberIdentityId: string) => Promise<boolean>
}

export function AiPersonMergeDialog({ open, onOpenChange, group, groups, items, busy, onMerge, onUnmerge }: AiPersonMergeDialogProps) {
  const [sourceGroupId, setSourceGroupId] = useState('')
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const candidates = groups.filter((candidate) => candidate.id !== group?.id)
  const mergedMembers = group?.mergedMembers ?? []

  useEffect(() => { if (!open) setSourceGroupId('') }, [open])

  return <Dialog
    open={open}
    onOpenChange={onOpenChange}
    title={group ? `管理「${group.name}」的人物合并` : '管理人物合并'}
    className="ai-person-merge-dialog"
    footer={<>
      <Button variant="secondary" onClick={() => onOpenChange(false)}>关闭</Button>
      <Button variant="primary" disabled={busy || !sourceGroupId} onClick={async () => {
        if (await onMerge(sourceGroupId)) setSourceGroupId('')
      }}>合并所选人物</Button>
    </>}
  >
    <div className="ai-person-merge-body">
      <section>
        <strong>已合并</strong>
        {mergedMembers.length > 0 ? <div className="ai-person-merged-list">{mergedMembers.map((member) => <div key={member.id}>
          <span className="ai-person-merged-avatar">{member.avatarDataUrl ? <img src={member.avatarDataUrl} alt="" /> : <UserRound size={18} />}</span>
          <span>{member.name}</span>
          <Button variant="danger" size="mini" icon={<Trash2 size={13} />} disabled={busy} onClick={() => void onUnmerge(member.id)}>移除</Button>
        </div>)}</div> : <span className="ai-person-merge-empty">当前没有已合并的人物</span>}
      </section>
      <section>
        <strong>可合并人物</strong>
        {candidates.length > 0 ? <div className="ai-selection-person-merge-list">{candidates.map((candidate) => <button key={candidate.id} type="button" className={sourceGroupId === candidate.id ? 'selected' : ''} onClick={() => setSourceGroupId(candidate.id)}>
          <AiFaceGroupCover group={candidate} item={itemsById.get(candidate.coverItemId)} /><span>{candidate.name}</span><strong>{candidate.itemIds.length}</strong>
        </button>)}</div> : <span className="ai-person-merge-empty">没有其他可合并人物</span>}
      </section>
    </div>
  </Dialog>
}
