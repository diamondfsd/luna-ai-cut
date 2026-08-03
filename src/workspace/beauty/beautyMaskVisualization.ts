import { BEAUTY_BODY_LAYER_ID, BEAUTY_FACE_LAYER_ID } from './beautyLayers'

export interface BeautyMaskVisualizationItem {
  id: string
  label: string
  color: string
  rgb: readonly [number, number, number]
}

export const BEAUTY_MASK_VISUALIZATION: readonly BeautyMaskVisualizationItem[] = [
  { id: BEAUTY_BODY_LAYER_ID, label: '身体肌肤', color: '#35C46A', rgb: [53, 196, 106] },
  { id: BEAUTY_FACE_LAYER_ID, label: '面部肌肤', color: '#21C7D9', rgb: [33, 199, 217] },
]
