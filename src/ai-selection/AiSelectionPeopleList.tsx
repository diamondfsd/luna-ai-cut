import { useEffect, useMemo, useRef, useState } from 'react'
import { EyeOff, GitMerge, Image as ImageIcon, MoreHorizontal, Pencil } from 'lucide-react'

import type { AiFaceGroup, AiSelectionItem } from '../shared/types'
import { Button, Dialog, IconButton, Input, Popover, PopoverContent, PopoverTrigger } from '../ui'
import { AiFaceGroupCover } from './AiPeopleGroupCover'
import { AiPersonAvatarDialog } from './AiPersonAvatarDialog'
import { AiPersonMergeDialog } from './AiPersonMergeDialog'
import './AiSelectionPeopleList.css'

interface AiSelectionPeopleListProps {
  groups: AiFaceGroup[]
  activeGroupId: string | undefined
  items: AiSelectionItem[]
  busy: boolean
  onSelect: (groupId: string) => void
  onRename: (groupId: string, name: string) => Promise<boolean>
  onSetAvatar: (groupId: string, itemId: string, bounds: { x: number; y: number; width: number; height: number }) => Promise<boolean>
  onMerge: (targetGroupId: string, sourceGroupId: string) => Promise<boolean>
  onUnmerge: (targetGroupId: string, memberIdentityId: string) => Promise<boolean>
  onHide: (groupId: string) => Promise<boolean>
}

interface AiSelectionPersonMenuProps extends Omit<AiSelectionPeopleListProps, 'activeGroupId' | 'onSelect'> {
  group: AiFaceGroup
}

function AiSelectionPersonMenu({ group, groups, items, busy, onRename, onSetAvatar, onMerge, onUnmerge, onHide }: AiSelectionPersonMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
  const [hideOpen, setHideOpen] = useState(false)
  const [renameValue, setRenameValue] = useState('')
  const closeTimerRef = useRef<number | null>(null)

  useEffect(() => () => {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
  }, [])

  function keepMenuOpen(): void {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    setMenuOpen(true)
  }

  function closeMenuSoon(): void {
    if (closeTimerRef.current !== null) window.clearTimeout(closeTimerRef.current)
    closeTimerRef.current = window.setTimeout(() => setMenuOpen(false), 180)
  }

  async function saveName(): Promise<void> {
    if (await onRename(group.id, renameValue)) setRenameOpen(false)
  }

  async function hidePerson(): Promise<void> {
    if (await onHide(group.id)) setHideOpen(false)
  }

  return <>
    <Popover open={menuOpen} onOpenChange={setMenuOpen}>
      <PopoverTrigger asChild>
        <IconButton
          variant="ghost"
          size="mini"
          className={`ai-selection-person-menu-trigger${menuOpen ? ' is-open' : ''}`}
          icon={<MoreHorizontal size={16} />}
          aria-label={`${group.name}的更多操作`}
          disabled={busy}
          onPointerEnter={keepMenuOpen}
          onPointerLeave={closeMenuSoon}
        />
      </PopoverTrigger>
      <PopoverContent className="ai-selection-person-menu" align="end" sideOffset={4} onPointerEnter={keepMenuOpen} onPointerLeave={closeMenuSoon}>
        <Button variant="ghost" size="compact" icon={<Pencil size={14} />} onClick={() => { setMenuOpen(false); setRenameValue(group.name); setRenameOpen(true) }}>改名</Button>
        <Button variant="ghost" size="compact" icon={<ImageIcon size={14} />} onClick={() => { setMenuOpen(false); setAvatarOpen(true) }}>换头像</Button>
        <Button variant="ghost" size="compact" icon={<GitMerge size={14} />} disabled={groups.length < 2 && !group.mergedMembers?.length} onClick={() => { setMenuOpen(false); setMergeOpen(true) }}>合并人物</Button>
        <Button variant="ghost" size="compact" icon={<EyeOff size={14} />} onClick={() => { setMenuOpen(false); setHideOpen(true) }}>隐藏人物</Button>
      </PopoverContent>
    </Popover>
    <Dialog open={renameOpen} onOpenChange={setRenameOpen} title="人物名称" footer={<><Button variant="secondary" onClick={() => setRenameOpen(false)}>取消</Button><Button variant="primary" disabled={busy || !renameValue.trim()} onClick={() => void saveName()}>保存</Button></>}>
      <Input variant="compact" fullWidth value={renameValue} maxLength={40} autoFocus onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter' && renameValue.trim()) void saveName() }} />
    </Dialog>
    <AiPersonAvatarDialog open={avatarOpen} onOpenChange={setAvatarOpen} group={group} items={items} busy={busy} onSave={(itemId, bounds) => onSetAvatar(group.id, itemId, bounds)} />
    <AiPersonMergeDialog open={mergeOpen} onOpenChange={setMergeOpen} group={group} groups={groups} items={items} busy={busy} onMerge={(sourceGroupId) => onMerge(group.id, sourceGroupId)} onUnmerge={(memberIdentityId) => onUnmerge(group.id, memberIdentityId)} />
    <Dialog open={hideOpen} onOpenChange={setHideOpen} title="隐藏这个人物？" description="人物分组会暂时从所有选片结果中隐藏，照片和视频不会被删除。可随时从“已隐藏人物”恢复。" footer={<><Button variant="secondary" onClick={() => setHideOpen(false)}>取消</Button><Button variant="primary" disabled={busy} onClick={() => void hidePerson()}>隐藏人物</Button></>} />
  </>
}

export function AiSelectionPeopleList({ groups, activeGroupId, items, busy, onSelect, onRename, onSetAvatar, onMerge, onUnmerge, onHide }: AiSelectionPeopleListProps) {
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  return <>{groups.map((group) => <div key={group.id} className="ai-selection-person-filter">
    <Button
      variant="ghost"
      size="compact"
      className={activeGroupId === group.id ? 'active' : ''}
      icon={<AiFaceGroupCover group={group} item={itemsById.get(group.coverItemId)} />}
      onClick={() => onSelect(group.id)}
    ><span>{group.name}</span><strong>{group.itemIds.length}</strong></Button>
    <AiSelectionPersonMenu group={group} groups={groups} items={items} busy={busy} onRename={onRename} onSetAvatar={onSetAvatar} onMerge={onMerge} onUnmerge={onUnmerge} onHide={onHide} />
  </div>)}</>
}
