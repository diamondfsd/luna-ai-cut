import type { AiSelectionItem } from '../shared/types'
import { coverFittedFaceBounds } from './aiFaceOverlayGeometry'
import type { AiSelectionFaceOverlayFace } from './aiFaceOverlayGroups'
import './AiSelectionFaceOverlay.css'

export function AiSelectionFaceOverlay({ item, faces }: { item: AiSelectionItem; faces: AiSelectionFaceOverlayFace[] }) {
  if (item.kind !== 'image' || !item.width || !item.height || faces.length === 0) return null
  return <div className="ai-selection-face-overlay" aria-hidden="true">{faces.map((face, index) => {
    const bounds = coverFittedFaceBounds(face.bounds, item.width!, item.height!)
    return <span
      key={`${face.label}-${index}`}
      className="ai-selection-face-overlay-box"
      style={{ left: `${bounds.x * 100}%`, top: `${bounds.y * 100}%`, width: `${bounds.width * 100}%`, height: `${bounds.height * 100}%` }}
    ><span>{face.label}</span></span>
  })}</div>
}
