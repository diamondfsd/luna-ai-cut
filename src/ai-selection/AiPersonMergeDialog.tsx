import { useEffect, useMemo, useState } from 'react'
import { Trash2 } from 'lucide-react'

import type { AiFaceGroup, AiSelectionItem } from '../shared/types'
import { Button, Dialog } from '../ui'
import { AiFaceGroupCover } from './AiPeopleGroupCover'
import { AiPersonIdentityAvatar } from './AiPersonIdentityAvatar'
import './AiPersonMergeDialog.css'

interface AiPersonMergeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  group: AiFaceGroup | null
  groups: AiFaceGroup[]
  items: AiSelectionItem[]
  busy: boolean
  onMerge: (sourceGroupIds: string[]) => Promise<boolean>
  onUnmerge: (memberIdentityId: string) => Promise<boolean>
}

export function AiPersonMergeDialog({ open, onOpenChange, group, groups, items, busy, onMerge, onUnmerge }: AiPersonMergeDialogProps) {
  const [sourceGroupIds, setSourceGroupIds] = useState<string[]>([])
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  // Merged members are not independent groups. Also keep merged roots out of the
  // picker so every new merge starts from two standalone people.
  const candidates = groups.filter((candidate) => candidate.id !== group?.id && !candidate.mergedMembers?.length)
  const mergedMembers = group?.mergedMembers ?? []

  useEffect(() => { if (!open) setSourceGroupIds([]) }, [open])

  function toggleSourceGroup(groupId: string): void {
    setSourceGroupIds((current) => current.includes(groupId)
      ? current.filter((candidate) => candidate !== groupId)
      : [...current, groupId])
  }

  return <Dialog
    open={open}
    onOpenChange={onOpenChange}
    title={group ? `管理「${group.name}」的人物合并` : '管理人物合并'}
    className="ai-person-merge-dialog"
    footer={<>
      <Button variant="secondary" onClick={() => onOpenChange(false)}>关闭</Button>
      <Button variant="primary" disabled={busy || sourceGroupIds.length === 0} onClick={async () => {
        if (await onMerge(sourceGroupIds)) setSourceGroupIds([])
      }}>合并 {sourceGroupIds.length} 人</Button>
    </>}
  >
    <div className="ai-person-merge-body">
      {mergedMembers.length > 0 && <section className="ai-person-merged-section">
        <strong>已合并人物</strong>
        <div className="ai-person-merged-list">{mergedMembers.map((member) => <div key={member.id}>
          <AiPersonIdentityAvatar {...member} className="ai-person-merged-avatar" />
          <span>{member.name}</span>
          <Button variant="danger" size="mini" icon={<Trash2 size={13} />} disabled={busy} onClick={() => void onUnmerge(member.id)}>移除</Button>
        </div>)}</div>
      </section>}
      <section className="ai-person-merge-candidates-section">
        <strong>可合并人物</strong>
        {candidates.length > 0 ? <div className="ai-person-merge-candidate-list">{candidates.map((candidate) => <Button key={candidate.id} variant="ghost" className={sourceGroupIds.includes(candidate.id) ? 'selected' : ''} icon={<AiFaceGroupCover group={candidate} item={itemsById.get(candidate.coverItemId)} showFaceBounds />} aria-pressed={sourceGroupIds.includes(candidate.id)} onClick={() => toggleSourceGroup(candidate.id)}>
          <span>{candidate.name}</span><strong>{candidate.itemIds.length}</strong>
        </Button>)}</div> : <span className="ai-person-merge-empty">没有可继续合并的人物</span>}
      </section>
    </div>
  </Dialog>
}
