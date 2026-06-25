import * as RadixTabs from '@radix-ui/react-tabs'

/* ==================== Root ==================== */
export const Tabs = RadixTabs.Root
export const TabsList = RadixTabs.List
export const TabsTrigger = RadixTabs.Trigger
export const TabsContent = RadixTabs.Content

/* ==================== 预设变体 ==================== */

interface PillTabsProps {
  value: string
  onValueChange: (value: string) => void
  items: Array<{ value: string; label: string }>
  className?: string
}

/**
 * 药丸形标签切换 — 类似 SegmentedControl，用于紧凑的筛选切换
 *
 * 用法：
 * ```tsx
 * <PillTabs value={tab} onValueChange={setTab}
 *   items={[{value:'a',label:'A'},{value:'b',label:'B'}]} />
 * ```
 */
export function PillTabs({ value, onValueChange, items, className }: PillTabsProps) {
  return (
    <RadixTabs.Root value={value} onValueChange={onValueChange}>
      <RadixTabs.List className={`ui-pill-tabs ${className ?? ''}`}>
        {items.map((item) => (
          <RadixTabs.Trigger
            key={item.value}
            value={item.value}
            className="ui-pill-tab-trigger"
          >
            {item.label}
          </RadixTabs.Trigger>
        ))}
      </RadixTabs.List>
    </RadixTabs.Root>
  )
}
