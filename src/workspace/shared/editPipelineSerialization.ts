import type { EditPipeline, PipelinePatch } from './editPipeline'
import { createDefaultPipeline, mergePipeline } from './editPipeline'

export function serializePipeline(pipeline: EditPipeline): string {
  return JSON.stringify(pipeline)
}

export function deserializePipeline(value: string): EditPipeline {
  const parsed = JSON.parse(value) as PipelinePatch
  return mergePipeline(createDefaultPipeline(), parsed)
}
