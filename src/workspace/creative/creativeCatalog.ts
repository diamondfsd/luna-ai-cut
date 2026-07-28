import { Droplets, LayoutTemplate, ScanLine, ScanSearch, WandSparkles, type LucideIcon } from 'lucide-react'

import type { WorkspaceMediaKind } from '../../shared/types'

export type CreativeModeId = 'triple-stitch' | 'color-reveal' | 'only-your-color' | 'pixel-stretch' | 'pixel-flow'

export interface CreativeCatalogItem {
  id: CreativeModeId
  name: string
  subtitle: string
  description: string
  icon: LucideIcon
  previewClassName: string
  supportedMediaKinds?: readonly WorkspaceMediaKind[]
}

export interface CreativeModuleProps {
  onBack: () => void
  onAddMedia: () => void
  onImportLocal: () => void
  supportedMediaKinds?: readonly WorkspaceMediaKind[]
}

export const CREATIVE_CATALOG: readonly CreativeCatalogItem[] = [
  {
    id: 'pixel-flow',
    name: '像素流光',
    subtitle: '像素流光',
    description: '细密像素从上方落下，沿画面层次唤醒原有色彩',
    icon: ScanLine,
    previewClassName: 'workspace-creative-preview--pixel-flow',
    supportedMediaKinds: ['image', 'video'],
  },
  {
    id: 'only-your-color',
    name: '只有你的色彩',
    subtitle: '只有你的色彩',
    description: '保留主体色彩，让背景自然呈现黑白质感',
    icon: Droplets,
    previewClassName: 'workspace-creative-preview--only-your-color',
    supportedMediaKinds: ['image'],
  },
  {
    id: 'pixel-stretch',
    name: '像素拉伸',
    subtitle: '像素拉伸',
    description: '识别主体后，将背景延展为像素流动效果',
    icon: ScanSearch,
    previewClassName: 'workspace-creative-preview--pixel-stretch',
    supportedMediaKinds: ['image'],
  },
  {
    id: 'color-reveal',
    name: '色彩还原',
    subtitle: '色彩还原',
    description: '首帧停留后，分段揭示还原后的色彩',
    icon: WandSparkles,
    previewClassName: 'workspace-creative-preview--color',
    supportedMediaKinds: ['image', 'video'],
  },
  {
    id: 'triple-stitch',
    name: 'Live 三拼',
    subtitle: '三拼视频',
    description: '将三个素材拼成 9:16 竖版内容',
    icon: LayoutTemplate,
    previewClassName: 'workspace-creative-preview--triple',
    supportedMediaKinds: ['image', 'video'],
  },
]

const CREATIVE_BY_ID = new Map(CREATIVE_CATALOG.map((item) => [item.id, item]))

export function getCreativeCatalogItem(id: CreativeModeId | null): CreativeCatalogItem | null {
  return id ? CREATIVE_BY_ID.get(id) ?? null : null
}
