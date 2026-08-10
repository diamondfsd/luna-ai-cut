import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, EyeOff, GitMerge, Image as ImageIcon, MoreHorizontal, Pencil } from 'lucide-react'

import type { AiFaceGroup, AiSelectionItem } from '../shared/types'
import { Button, IconButton, Input, Popover, PopoverContent, PopoverTrigger, toast, Tooltip } from '../ui'
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
  onMerge: (targetGroupId: string, sourceGroupIds: string[]) => Promise<boolean>
  onUnmerge: (targetGroupId: string, memberIdentityId: string) => Promise<boolean>
  onHide: (groupId: string) => Promise<boolean>
}

interface AiSelectionPersonMenuProps extends Omit<AiSelectionPeopleListProps, 'activeGroupId' | 'onSelect' | 'onRename'> {
  group: AiFaceGroup
}

interface AiSelectionPersonRowProps extends AiSelectionPersonMenuProps {
  active: boolean
  item: AiSelectionItem | undefined
  onRename: AiSelectionPeopleListProps['onRename']
  onSelect: AiSelectionPeopleListProps['onSelect']
}

function AiSelectionPersonMenu({ group, groups, items, busy, onSetAvatar, onMerge, onUnmerge, onHide }: AiSelectionPersonMenuProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [avatarOpen, setAvatarOpen] = useState(false)
  const [mergeOpen, setMergeOpen] = useState(false)
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

  async function hidePerson(): Promise<void> {
    setMenuOpen(false)
    if (await onHide(group.id)) toast.success(`已隐藏「${group.name}」`)
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
        <Button variant="ghost" size="compact" icon={<ImageIcon size={14} />} onClick={() => { setMenuOpen(false); setAvatarOpen(true) }}>换头像</Button>
        <Button variant="ghost" size="compact" icon={<GitMerge size={14} />} disabled={groups.length < 2 && !group.mergedMembers?.length} onClick={() => { setMenuOpen(false); setMergeOpen(true) }}>合并人物</Button>
        <Button variant="ghost" size="compact" icon={<EyeOff size={14} />} onClick={() => void hidePerson()}>隐藏人物</Button>
      </PopoverContent>
    </Popover>
    <AiPersonAvatarDialog open={avatarOpen} onOpenChange={setAvatarOpen} group={group} items={items} busy={busy} onSave={(itemId, bounds) => onSetAvatar(group.id, itemId, bounds)} />
    <AiPersonMergeDialog open={mergeOpen} onOpenChange={setMergeOpen} group={group} groups={groups} items={items} busy={busy} onMerge={(sourceGroupIds) => onMerge(group.id, sourceGroupIds)} onUnmerge={(memberIdentityId) => onUnmerge(group.id, memberIdentityId)} />
  </>
}

function AiSelectionPersonRow({ group, groups, items, item, active, busy, onRename, onSelect, onSetAvatar, onMerge, onUnmerge, onHide }: AiSelectionPersonRowProps) {
  const [editing, setEditing] = useState(false)
  const [renameValue, setRenameValue] = useState(group.name)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!editing) return
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [editing])

  function startRename(): void {
    setRenameValue(group.name)
    setEditing(true)
  }

  function cancelRename(): void {
    setRenameValue(group.name)
    setEditing(false)
  }

  async function saveName(): Promise<void> {
    const name = renameValue.trim()
    if (!name || name === group.name) {
      cancelRename()
      return
    }
    if (await onRename(group.id, name)) setEditing(false)
  }

  return <div className="ai-selection-person-filter">
    {editing ? <div className={`ai-selection-person-inline-editor${active ? ' active' : ''}`}>
      <AiFaceGroupCover group={group} item={item} showFaceBounds />
      <Input ref={inputRef} variant="compact" className="ai-selection-person-rename-input" value={renameValue} maxLength={40} disabled={busy} aria-label={`编辑 ${group.name} 的名称`} onChange={(event) => setRenameValue(event.target.value)} onKeyDown={(event) => {
        if (event.nativeEvent.isComposing) return
        if (event.key === 'Enter') { event.preventDefault(); void saveName() }
        if (event.key === 'Escape') { event.preventDefault(); cancelRename() }
      }} />
      <Tooltip content="保存名称"><IconButton variant="ghost" size="mini" icon={<Check size={15} />} aria-label="保存名称" disabled={busy || !renameValue.trim()} onClick={() => void saveName()} /></Tooltip>
    </div> : <>
      <Button variant="ghost" size="compact" className={`ai-selection-person-select${active ? ' active' : ''}`} icon={<AiFaceGroupCover group={group} item={item} showFaceBounds />} onClick={() => onSelect(group.id)}><span className="ai-selection-person-name">{group.name}</span><strong className="ai-selection-person-count">{group.itemIds.length}</strong></Button>
      <Tooltip content="编辑名称"><IconButton variant="ghost" size="mini" className="ai-selection-person-rename-trigger" icon={<Pencil size={14} />} aria-label={`编辑 ${group.name} 的名称`} disabled={busy} onClick={startRename} /></Tooltip>
      <AiSelectionPersonMenu group={group} groups={groups} items={items} busy={busy} onSetAvatar={onSetAvatar} onMerge={onMerge} onUnmerge={onUnmerge} onHide={onHide} />
    </>}
  </div>
}

export function AiSelectionPeopleList({ groups, activeGroupId, items, busy, onSelect, onRename, onSetAvatar, onMerge, onUnmerge, onHide }: AiSelectionPeopleListProps) {
  const itemsById = useMemo(() => new Map(items.map((item) => [item.id, item])), [items])
  return <div className="ai-selection-people-grid">{groups.map((group) => <AiSelectionPersonRow key={group.id} group={group} groups={groups} items={items} item={itemsById.get(group.coverItemId)} active={activeGroupId === group.id} busy={busy} onSelect={onSelect} onRename={onRename} onSetAvatar={onSetAvatar} onMerge={onMerge} onUnmerge={onUnmerge} onHide={onHide} />)}</div>
}
