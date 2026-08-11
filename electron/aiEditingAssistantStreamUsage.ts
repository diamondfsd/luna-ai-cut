import OpenAI from 'openai'

const UNSUPPORTED_PARAMETER_PATTERN =
  /unsupported|not supported|does not support|unknown|unrecognized|invalid (?:parameter|argument)|not allowed|not permitted|unexpected|extra fields?/i
const STREAM_USAGE_PARAMETER_PATTERN = /stream[_ -]?options|include[_ -]?usage/i

export function doesNotSupportStreamUsage(error: unknown): boolean {
  if (!(error instanceof OpenAI.APIError) || ![400, 422].includes(error.status ?? 0)) return false
  return STREAM_USAGE_PARAMETER_PATTERN.test(error.message) &&
    UNSUPPORTED_PARAMETER_PATTERN.test(error.message)
}

export async function runStreamWithUsageFallback<TStream, TResult>(options: {
  includeUsage?: boolean
  createStream(includeUsage: boolean): Promise<TStream>
  consumeStream(stream: TStream, onChunk: () => void): Promise<TResult>
  onUnsupported?(): void
}): Promise<TResult> {
  if (options.includeUsage === false) {
    const stream = await options.createStream(false)
    return options.consumeStream(stream, () => {})
  }

  let receivedChunk = false
  try {
    const stream = await options.createStream(true)
    return await options.consumeStream(stream, () => {
      receivedChunk = true
    })
  } catch (error) {
    if (receivedChunk || !doesNotSupportStreamUsage(error)) throw error
  }

  options.onUnsupported?.()
  const fallbackStream = await options.createStream(false)
  return options.consumeStream(fallbackStream, () => {})
}
