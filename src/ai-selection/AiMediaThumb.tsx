import { useEffect, useState } from 'react'
import { Film, Image as ImageIcon } from 'lucide-react'

import type { AiSelectionItem } from '../shared/types'

export function AiMediaThumb({ item }: { item: AiSelectionItem }) {
  const preferredSource = item.thumbnailUrl ?? item.videoKeyframes[0]?.thumbnailUrl ?? null
  const [source, setSource] = useState<string | null>(preferredSource)
  useEffect(() => {
    setSource(preferredSource)
    if (preferredSource || item.error || item.analysisState === 'pending') return
    let active = true
    void window.luna.resolveThumbnail(item.path, item.kind).then((value) => { if (active) setSource(value) }).catch(() => undefined)
    return () => { active = false }
  }, [item.analysisState, item.error, item.kind, item.path, preferredSource])
  if (source) return <img src={source} alt="" draggable={false} />
  return <span className="ai-selection-thumb-placeholder">{item.kind === 'video' ? <Film size={24} /> : <ImageIcon size={24} />}</span>
}
