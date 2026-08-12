import { describe, expect, it, vi } from 'vite-plus/test'
import type { NativeToolCallingLlmAdapter } from '@freecut/infrastructure/llm/openai-chat-completions-llm-adapter'
import type { EmbeddedAiAssistantGenerateResult } from '@freecut/shared/host/embedded-host'
import { NativeAgentDriver } from './native-driver'
import { runAgentHarness } from './runtime'

type Observation = { value: string }

function createAdapter(responses: EmbeddedAiAssistantGenerateResult[]): NativeToolCallingLlmAdapter {
  return {
    id: 'test-native',
    label: 'Test native adapter',
    isSupported: () => true,
    load: async () => undefined,
    generate: async () => '',
    dispose: () => undefined,
    generateWithTools: vi.fn(async () => {
      const response = responses.shift()
      if (!response) throw new Error('Missing test response')
      return response
    }),
  }
}

function createDriver(responses: EmbeddedAiAssistantGenerateResult[]) {
  return new NativeAgentDriver<Observation>({
    adapter: createAdapter(responses),
    messages: [
      { role: 'system', content: 'system' },
      { role: 'assistant', content: 'old answer' },
      { role: 'user', content: 'current request' },
    ],
    replayFromIndex: 2,
    getTools: () => ({
      definitions: [],
      idsByFunctionName: new Map([
        ['read_source', 'source.read'],
        ['commit_source', 'git.commit'],
      ]),
    }),
    serializeObservation: (observation) => JSON.stringify(observation),
    toolContinuationPrompt: 'continue after tools',
    requestOptions: () => ({}),
  })
}

function run(driver: NativeAgentDriver<Observation>, input: {
  executeTool?: (toolId: string) => Promise<Observation>
}) {
  return runAgentHarness({
    driver,
    maxRounds: 2,
    maxToolCallsPerRound: 8,
    protocolRepairPrompt: 'repair',
    continuationPrompt: 'continue',
    finalizationPrompt: 'finish',
    executeTool: (call) => input.executeTool?.(call.toolId) ?? Promise.resolve({ value: call.toolId }),
  })
}

describe('runAgentHarness replay transcript', () => {
  it('records the current user message and final text output', async () => {
    const driver = createDriver([
      { mode: 'tools', content: 'Finished.', toolCalls: [] },
    ])

    const result = await run(driver, {})

    expect(result.status).toBe('completed')
    expect(result.protocol).toBe('native')
    expect(result.replayMessages).toEqual([
      { role: 'user', content: 'current request' },
      { role: 'assistant', content: 'Finished.' },
    ])
  })

  it('returns every tool result to the model and waits for its final response', async () => {
    const driver = createDriver([
      {
        mode: 'tools',
        content: '',
        toolCalls: [
          { id: 'call-1', name: 'commit_source', arguments: '{"message":"save"}' },
          { id: 'call-2', name: 'read_source', arguments: '{"path":"timeline.ts"}' },
        ],
      },
      { mode: 'tools', content: 'Finished after tools.', toolCalls: [] },
    ])
    const executeTool = vi.fn(async (toolId: string) => ({ value: `${toolId}:ok` }))

    const result = await run(driver, { executeTool })

    expect(executeTool).toHaveBeenCalledTimes(2)
    expect(result.status).toBe('completed')
    expect(result.replayMessages).toEqual([
      { role: 'user', content: 'current request' },
      {
        role: 'assistant',
        toolCalls: [
          { id: 'call-1', name: 'commit_source', arguments: '{"message":"save"}' },
          { id: 'call-2', name: 'read_source', arguments: '{"path":"timeline.ts"}' },
        ],
      },
      { role: 'tool', toolCallId: 'call-1', content: '{"value":"git.commit:ok"}' },
      { role: 'tool', toolCallId: 'call-2', content: '{"value":"source.read:ok"}' },
      { role: 'user', content: 'continue after tools' },
      { role: 'assistant', content: 'Finished after tools.' },
    ])
  })

  it('returns cloned replay messages that callers cannot mutate', () => {
    const driver = createDriver([])
    const first = driver.replayMessages
    first[0] = { role: 'user', content: 'changed' }

    expect(driver.replayMessages).toEqual([{ role: 'user', content: 'current request' }])
  })
})
