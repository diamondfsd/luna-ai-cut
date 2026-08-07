import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Layers, Palette, Scissors } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useEditorStore } from '@freecut/shared/state/editor'
import type { EditorWorkspaceId } from '@freecut/config/editor-workspaces'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@freecut/components/ui/select'

const WORKSPACE_ITEMS: readonly {
  id: EditorWorkspaceId
  icon: LucideIcon
  labelKey: string
}[] = [
  { id: 'edit', icon: Scissors, labelKey: 'toolbar.workspaces.edit' },
  { id: 'color', icon: Palette, labelKey: 'toolbar.workspaces.color' },
  { id: 'motion', icon: Layers, labelKey: 'toolbar.workspaces.motion' },
]

export const WorkspaceSwitcher = memo(function WorkspaceSwitcher() {
  const { t } = useTranslation()
  const workspace = useEditorStore((s) => s.workspace)
  const setWorkspace = useEditorStore((s) => s.setWorkspace)
  const activeItem = WORKSPACE_ITEMS.find((item) => item.id === workspace)
  const ActiveIcon = activeItem?.icon ?? Scissors

  return (
    <Select value={workspace} onValueChange={(value) => setWorkspace(value as EditorWorkspaceId)}>
      <SelectTrigger
        aria-label={t('toolbar.workspaces.label')}
        className="h-8 min-w-[112px] gap-1.5 border-white/10 bg-white/5 px-2.5 text-xs text-foreground shadow-none hover:bg-white/10"
      >
        <ActiveIcon className="h-3.5 w-3.5 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end" className="min-w-[144px]">
        {WORKSPACE_ITEMS.map(({ id, icon: Icon, labelKey }) => (
          <SelectItem key={id} value={id} className="gap-2">
            <Icon className="h-3.5 w-3.5" />
            <span>{t(labelKey)}</span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
})
