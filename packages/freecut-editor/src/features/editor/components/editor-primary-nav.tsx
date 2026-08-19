import { memo } from 'react'
import type { LucideIcon } from 'lucide-react'
import { cn } from '@freecut/shared/ui/cn'
import type { EditorSidebarTab } from '@freecut/config/editor-workspaces'
import './editor-primary-nav.css'

export interface EditorPrimaryNavItem {
  id: EditorSidebarTab
  icon: LucideIcon
  label: string
}

interface EditorPrimaryNavProps {
  items: readonly EditorPrimaryNavItem[]
  activeTab: EditorSidebarTab
  onSelect: (tab: EditorSidebarTab) => void
}

export const EditorPrimaryNav = memo(function EditorPrimaryNav({
  items,
  activeTab,
  onSelect,
}: EditorPrimaryNavProps) {
  return (
    <div
      role="tablist"
      aria-orientation="horizontal"
      className="editor-primary-nav panel-header shrink-0 border-b border-border"
    >
      {items.map(({ id, icon: Icon, label }) => {
        const selected = activeTab === id
        return (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={label}
            onClick={() => onSelect(id)}
            className={cn(
              'editor-primary-nav__item relative flex min-w-0 flex-col items-center justify-center gap-0.5 text-[10px] font-normal transition-colors',
              selected
                ? 'text-primary'
                : 'text-muted-foreground hover:bg-secondary/40 hover:text-foreground',
            )}
          >
            <Icon className="h-[15px] w-[15px]" />
            <span className="whitespace-nowrap leading-none">{label}</span>
            {selected && <span className="absolute inset-x-3 bottom-0 h-px bg-primary/90" />}
          </button>
        )
      })}
    </div>
  )
})
