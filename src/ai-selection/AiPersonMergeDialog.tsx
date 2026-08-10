import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { Trash2, X } from 'lucide-react'

import type { AiFaceGroup, AiSelectionItem } from '../shared/types'
import { Button, Dialog, IconButton, Tooltip } from '../ui'
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

interface MergeCardContentProps {
  media: ReactNode
  name: string
  count?: number
}

function MergeCardContent({ media, name, count }: MergeCardContentProps) {
  return <>
    <span className="merge-dialog-card-media">{media}</span>
    <span className="merge-dialog-card-info">
      <span className="merge-dialog-card-name" title={name}>{name}</span>
      {count != null && <span className="merge-dialog-card-count">{count} 项</span>}
    </span>
  </>
}

export function AiPersonMergeDialog({ open, onOpenChange, group, groups, items, busy, onMerge, onUnmerge }: AiPersonMergeDialogProps) {
  const [sourceGroupIds, setSourceGroupIds] = useState<string[]>([])
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  const candidates = groups.filter((candidate) => candidate.id !== group?.id && !candidate.mergedMembers?.length)
  const selectedGroups = sourceGroupIds.map((id) => candidates.find((candidate) => candidate.id === id)).filter((candidate): candidate is AiFaceGroup => Boolean(candidate))
  const availableCandidates = candidates.filter((candidate) => !sourceGroupIds.includes(candidate.id))
  const mergedMembers = group?.mergedMembers ?? []
  const personCount = mergedMembers.length + candidates.length
  const sizeClass = personCount <= 3 ? ' is-compact' : personCount <= 6 ? ' is-medium' : ''

  useEffect(() => { if (!open) setSourceGroupIds([]) }, [open])

  return <Dialog
    open={open}
    onOpenChange={onOpenChange}
    title={group ? `管理「${group.name}」的人物合并` : '管理人物合并'}
    className={`merge-dialog${sizeClass}`}
    footer={<>
      <Button variant="secondary" onClick={() => onOpenChange(false)}>取消</Button>
      <Button variant="primary" disabled={busy || sourceGroupIds.length === 0} onClick={async () => {
        if (await onMerge(sourceGroupIds)) onOpenChange(false)
      }}>{sourceGroupIds.length > 0 ? `确认合并 ${sourceGroupIds.length} 人` : '确认合并'}</Button>
    </>}
  >
    <div className="merge-dialog-body">
      {(mergedMembers.length > 0 || selectedGroups.length > 0) && <section className="merge-dialog-section merge-dialog-section-merged">
        <h2 className="merge-dialog-section-title">已合并 / 待确认</h2>
        <div className="merge-dialog-card-list">
          {mergedMembers.map((member) => <div key={member.id} className="merge-dialog-card-wrap">
            <div className="merge-dialog-card merge-dialog-card-static" aria-label={member.name}>
              <MergeCardContent
                media={<AiPersonIdentityAvatar {...member} className="merge-dialog-avatar" />}
                name={member.name}
              />
            </div>
            <Tooltip content="移除这个人物">
              <IconButton
                variant="ghost"
                size="mini"
                className="merge-dialog-remove"
                icon={<Trash2 size={15} />}
                aria-label={`移除 ${member.name}`}
                disabled={busy}
                onClick={() => void onUnmerge(member.id)}
              />
            </Tooltip>
          </div>)}
          {selectedGroups.map((candidate) => <div key={candidate.id} className="merge-dialog-card-wrap">
            <div className="merge-dialog-card merge-dialog-card-static" aria-label={`${candidate.name}，待确认合并`}>
              <MergeCardContent
                media={<AiFaceGroupCover group={candidate} item={itemsById.get(candidate.coverItemId)} showFaceBounds />}
                name={candidate.name}
                count={candidate.itemIds.length}
              />
            </div>
            <Tooltip content="取消选择">
              <IconButton
                variant="ghost"
                size="mini"
                className="merge-dialog-remove"
                icon={<X size={15} />}
                aria-label={`取消选择 ${candidate.name}`}
                disabled={busy}
                onClick={() => setSourceGroupIds((current) => current.filter((id) => id !== candidate.id))}
              />
            </Tooltip>
          </div>)}
        </div>
      </section>}

      <section className="merge-dialog-section">
        <h2 className="merge-dialog-section-title">可合并人物</h2>
        {availableCandidates.length > 0 ? <div className="merge-dialog-card-list">
          {availableCandidates.map((candidate) => <Button
            key={candidate.id}
            variant="ghost"
            className="merge-dialog-card merge-dialog-card-selectable"
            aria-label={`选择 ${candidate.name}，${candidate.itemIds.length} 项`}
            disabled={busy}
            onClick={() => setSourceGroupIds((current) => [...current, candidate.id])}
          >
            <MergeCardContent
              media={<AiFaceGroupCover group={candidate} item={itemsById.get(candidate.coverItemId)} showFaceBounds />}
              name={candidate.name}
              count={candidate.itemIds.length}
            />
          </Button>)}
        </div> : <p className="merge-dialog-empty">没有可继续合并的人物</p>}
      </section>
    </div>
  </Dialog>
}
