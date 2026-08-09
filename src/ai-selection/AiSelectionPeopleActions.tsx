import { useState, type ReactNode } from 'react'
import { GitMerge, Image as ImageIcon, Pencil, RefreshCw, Trash2 } from 'lucide-react'

import type { AiFaceGroup, AiSelectionItem } from '../shared/types'
import { Button, Dialog, Input, LoadingIndicator } from '../ui'
import { AiPersonAvatarDialog } from './AiPersonAvatarDialog'
import { AiPersonMergeDialog } from './AiPersonMergeDialog'

interface AiSelectionPeopleActionsProps {
  group: AiFaceGroup | null
  groups: AiFaceGroup[]
  items: AiSelectionItem[]
  title: string
  countLabel: string
  busy: boolean
  analysisLabel: string | null
  selectAllAction: ReactNode
  canAnalyze: boolean
  onAnalyze: () => void
  onRename: (groupId: string, name: string) => Promise<boolean>
  onSetAvatar: (groupId: string, itemId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<boolean>
  onMerge: (targetGroupId: string, sourceGroupId: string) => Promise<boolean>
  onUnmerge: (targetGroupId: string, memberIdentityId: string) => Promise<boolean>
  onDelete: (groupId: string) => Promise<boolean>
}

export function AiSelectionPeopleActions({
  group,
  groups,
  items,
  title,
  countLabel,
  busy,
  analysisLabel,
  selectAllAction,
  canAnalyze,
  onAnalyze,
  onRename,
  onSetAvatar,
  onMerge,
  onUnmerge,
  onDelete,
}: AiSelectionPeopleActionsProps) {
  const [renameOpen, setRenameOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')

  async function saveName(): Promise<void> {
    if (group && await onRename(group.id, renameValue)) setRenameOpen(false)
  }

  async function deletePerson(): Promise<void> {
    if (group && await onDelete(group.id)) setDeleteOpen(false)
  }

  return <>
    <header className="ai-selection-view-heading">
      <div>
        <h2>{title}</h2>
        {analysisLabel ? <div className="ai-selection-heading-loading"><LoadingIndicator label={analysisLabel} /></div> : <span>{countLabel}</span>}
      </div>
      <div className="ai-selection-view-actions">
        {selectAllAction}
        {group && <Button variant="secondary" size="compact" icon={<Pencil size={14} />} disabled={busy} onClick={() => { setRenameValue(group.name); setRenameOpen(true) }}>改名</Button>}
        {group && <Button variant="secondary" size="compact" icon={<ImageIcon size={14} />} disabled={busy} onClick={() => setAvatarOpen(true)}>换头像</Button>}
        {group && <Button variant="secondary" size="compact" icon={<GitMerge size={14} />} disabled={busy || (groups.length < 2 && !group.mergedMembers?.length)} onClick={() => setMergeOpen(true)}>合并</Button>}
        {group && <Button variant="danger" size="compact" icon={<Trash2 size={14} />} disabled={busy} onClick={() => setDeleteOpen(true)}>删除人物</Button>}
        <Button variant="secondary" size="compact" icon={<RefreshCw size={14} />} disabled={busy || !canAnalyze} onClick={onAnalyze}>重新分析</Button>
      </div>
    </header>
    <AiPersonAvatarDialog open={avatarOpen} onOpenChange={setAvatarOpen} group={group} items={items} busy={busy} onSave={(itemId, bounds) => group ? onSetAvatar(group.id, itemId, bounds) : Promise.resolve(false)} />
    <Dialog open={renameOpen} onOpenChange={setRenameOpen} title="人物名称" footer={<><Button variant="secondary" onClick={() => setRenameOpen(false)}>取消</Button><Button variant="primary" disabled={busy || !renameValue.trim()} onClick={() => void saveName()}>保存</Button></>}>
      <Input variant="compact" fullWidth value={renameValue} maxLength={40} autoFocus onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && renameValue.trim()) void saveName() }} />
    </Dialog>
    <Dialog open={deleteOpen} onOpenChange={setDeleteOpen} title="删除这个人物？" description="人物分组会从选片结果中移除，照片和视频不会被删除。再次分析时也不会重复显示这个人物。" footer={<><Button variant="secondary" onClick={() => setDeleteOpen(false)}>取消</Button><Button variant="danger" disabled={busy} onClick={() => void deletePerson()}>删除人物</Button></>} />
    <AiPersonMergeDialog open={mergeOpen} onOpenChange={setMergeOpen} group={group} groups={groups} items={items} busy={busy} onMerge={(sourceGroupId) => group ? onMerge(group.id, sourceGroupId) : Promise.resolve(false)} onUnmerge={(memberIdentityId) => group ? onUnmerge(group.id, memberIdentityId) : Promise.resolve(false)} />
  </>
}
