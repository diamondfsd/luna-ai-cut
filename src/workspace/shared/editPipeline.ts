export interface CropRect {
  x: number
  y: number
  w: number
  h: number
}

export interface EditPipeline {
  transform: {
    crop: CropRect | null
    rotate: number
    flipH: boolean
    flipV: boolean
    scale: number
  }
  color: {
    exposure: number
    contrast: number
    saturation: number
    vibrance: number
    temperature: number
    tint: number
    highlights: number
    shadows: number
    whites: number
    blacks: number
    clarity: number
    dehaze: number
  }
  effects: {
    sharpen: number
    vignette: number
  }
  watermark: {
    enabled: boolean
    styleId: string | null
    customImagePath: string | null
    opacity: number
    size: number
    position: 'topLeft' | 'topRight' | 'bottomLeft' | 'bottomRight' | 'center'
  }
}

export type PipelinePatch = {
  transform?: Partial<EditPipeline['transform']>
  color?: Partial<EditPipeline['color']>
  effects?: Partial<EditPipeline['effects']>
  watermark?: Partial<EditPipeline['watermark']>
}

export const DEFAULT_PIPELINE: EditPipeline = {
  transform: {
    crop: null,
    rotate: 0,
    flipH: false,
    flipV: false,
    scale: 1,
  },
  color: {
    exposure: 0,
    contrast: 0,
    saturation: 0,
    vibrance: 0,
    temperature: 0,
    tint: 0,
    highlights: 0,
    shadows: 0,
    whites: 0,
    blacks: 0,
    clarity: 0,
    dehaze: 0,
  },
  effects: {
    sharpen: 0,
    vignette: 0,
  },
  watermark: {
    enabled: false,
    styleId: null,
    customImagePath: null,
    opacity: 100,
    size: 15,
    position: 'bottomRight',
  },
}

export function createDefaultPipeline(): EditPipeline {
  return structuredClone(DEFAULT_PIPELINE)
}

export function mergePipeline(pipeline: EditPipeline, patch: PipelinePatch): EditPipeline {
  return {
    transform: { ...pipeline.transform, ...patch.transform },
    color: { ...pipeline.color, ...patch.color },
    effects: { ...pipeline.effects, ...patch.effects },
    watermark: { ...pipeline.watermark, ...patch.watermark },
  }
}

export function serializePipeline(pipeline: EditPipeline): string {
  return JSON.stringify(pipeline)
}

export function deserializePipeline(value: string): EditPipeline {
  const parsed = JSON.parse(value) as PipelinePatch
  return mergePipeline(createDefaultPipeline(), parsed)
}
