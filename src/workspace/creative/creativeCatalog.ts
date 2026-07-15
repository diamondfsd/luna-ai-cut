import { LayoutTemplate, WandSparkles, type LucideIcon } from 'lucide-react'

export type CreativeModeId = 'triple-stitch' | 'color-reveal'

export interface CreativeCatalogItem {
  id: CreativeModeId
  name: string
  subtitle: string
  description: string
  icon: LucideIcon
  previewClassName: string
}

export const CREATIVE_CATALOG: readonly CreativeCatalogItem[] = [
  {
    id: 'color-reveal',
    name: '灰片变正片',
    subtitle: '灰片变正片',
    description: '从左向右揭示调色后的完整画面',
    icon: WandSparkles,
    previewClassName: 'workspace-creative-preview--color',
  },
  {
    id: 'triple-stitch',
    name: 'Live 三拼',
    subtitle: '三拼视频',
    description: '将三个素材拼成 9:16 竖版内容',
    icon: LayoutTemplate,
    previewClassName: 'workspace-creative-preview--triple',
  },
]

const CREATIVE_BY_ID = new Map(CREATIVE_CATALOG.map((item) => [item.id, item]))

export function getCreativeCatalogItem(id: CreativeModeId | null): CreativeCatalogItem | null {
  return id ? CREATIVE_BY_ID.get(id) ?? null : null
}
