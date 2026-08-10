import type { ServerResponse } from 'node:http'

let chunkId = 0

export function beginChatCompletionStream(response: ServerResponse): void {
  response.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache',
    connection: 'keep-alive',
  })
}

export function writeChatCompletionDelta(
  response: ServerResponse,
  delta: Record<string, unknown>,
  finishReason: 'stop' | 'tool_calls' | null = null,
): void {
  chunkId += 1
  response.write(`data: ${JSON.stringify({
    id: `chatcmpl-e2e-${chunkId}`,
    object: 'chat.completion.chunk',
    created: 0,
    model: 'freecut-e2e',
    choices: [{ index: 0, delta, finish_reason: finishReason }],
  })}\n\n`)
}

export function finishChatCompletionStream(response: ServerResponse): void {
  response.end('data: [DONE]\n\n')
}

export function sendTextCompletion(response: ServerResponse, content: string): void {
  beginChatCompletionStream(response)
  const splitAt = Math.max(1, Math.floor(content.length / 2))
  writeChatCompletionDelta(response, { content: content.slice(0, splitAt) })
  writeChatCompletionDelta(response, { content: content.slice(splitAt) })
  writeChatCompletionDelta(response, {}, 'stop')
  finishChatCompletionStream(response)
}

export function sendToolCallCompletion(
  response: ServerResponse,
  toolCall: { id: string; name: string; arguments: string },
): void {
  beginChatCompletionStream(response)
  const splitAt = Math.max(1, Math.floor(toolCall.arguments.length / 2))
  writeChatCompletionDelta(response, {
    tool_calls: [{
      index: 0,
      id: toolCall.id,
      type: 'function',
      function: { name: toolCall.name, arguments: toolCall.arguments.slice(0, splitAt) },
    }],
  })
  writeChatCompletionDelta(response, {
    tool_calls: [{ index: 0, function: { arguments: toolCall.arguments.slice(splitAt) } }],
  })
  writeChatCompletionDelta(response, {}, 'tool_calls')
  finishChatCompletionStream(response)
}
