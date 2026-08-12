import type { AiEditingObservation, AiEditingToolResult } from './types'

const INLINE_RESULT_CHARS = 8_000
export const MAX_RESULT_READ_CHARS = 3_000
const DEFAULT_RESULT_READ_CHARS = 3_000
const RESULT_PREVIEW_CHARS = 800

interface StoredToolResult {
  content: string
  toolId: string
}

export interface ToolResultReadInput {
  resultId: string
  offset?: number
  maxChars?: number
}

export class ToolResultStore {
  private readonly results = new Map<string, StoredToolResult>()
  private readonly modelResults = new WeakMap<
    AiEditingObservation,
    { id: string; result: AiEditingToolResult }
  >()
  private nextId = 1

  forModel(observation: AiEditingObservation): { id: string; result: AiEditingToolResult } {
    const existing = this.modelResults.get(observation)
    if (existing) return existing
    const content = JSON.stringify(observation.result)
    if (content.length <= INLINE_RESULT_CHARS || observation.toolId === 'result.read') {
      const inline = { id: observation.toolId, result: observation.result }
      this.modelResults.set(observation, inline)
      return inline
    }

    const resultId = `result-${this.nextId}`
    this.nextId += 1
    this.results.set(resultId, { content, toolId: observation.toolId })
    const reference = {
      id: observation.toolId,
      result: {
        ok: observation.result.ok,
        message: '工具结果较大，请按需读取详细内容。',
        data: {
          resultId,
          totalChars: content.length,
          preview: content.slice(0, RESULT_PREVIEW_CHARS),
          nextOffset: 0,
          readWith: 'result.read',
        },
      },
    }
    this.modelResults.set(observation, reference)
    return reference
  }

  read({ resultId, offset = 0, maxChars = DEFAULT_RESULT_READ_CHARS }: ToolResultReadInput): AiEditingToolResult {
    const stored = this.results.get(resultId)
    if (!stored) return { ok: false, message: '这项详细结果已不可用，请重新执行原工具。' }
    const safeOffset = Math.min(Math.max(0, offset), stored.content.length)
    const safeMaxChars = Math.min(Math.max(1, maxChars), MAX_RESULT_READ_CHARS)
    const content = stored.content.slice(safeOffset, safeOffset + safeMaxChars)
    const nextOffset = safeOffset + content.length
    return {
      ok: true,
      message: `已读取 ${stored.toolId} 的部分详细结果。`,
      data: {
        resultId,
        toolId: stored.toolId,
        offset: safeOffset,
        totalChars: stored.content.length,
        content,
        nextOffset: nextOffset < stored.content.length ? nextOffset : null,
      },
    }
  }
}
