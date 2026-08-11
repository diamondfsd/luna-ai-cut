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
  shouldStopAfterTool?: (observations: readonly Observation[]) => boolean
}) {
  return runAgentHarness({
    driver,
    maxRounds: 2,
    maxToolCallsPerRound: 8,
    protocolRepairPrompt: 'repair',
    continuationPrompt: 'continue',
    finalizationPrompt: 'finish',
    executeTool: (call) => input.executeTool?.(call.toolId) ?? Promise.resolve({ value: call.toolId }),
    canCompleteFromText: ({ output }) => Boolean(output.content),
    shouldStopAfterTool: input.shouldStopAfterTool ?? (() => false),
    canRecoverFromModelError: () => false,
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

  it('records a complete executed exchange before stopping early', async () => {
    const driver = createDriver([
      {
        mode: 'tools',
        content: '',
        toolCalls: [
          { id: 'call-1', name: 'commit_source', arguments: '{"message":"save"}' },
          { id: 'call-2', name: 'read_source', arguments: '{"path":"timeline.ts"}' },
        ],
      },
    ])
    const executeTool = vi.fn(async (toolId: string) => ({ value: `${toolId}:ok` }))

    const result = await run(driver, {
      executeTool,
      shouldStopAfterTool: () => true,
    })

    expect(executeTool).toHaveBeenCalledTimes(1)
    expect(result.status).toBe('completed')
    expect(result.replayMessages).toEqual([
      { role: 'user', content: 'current request' },
      {
        role: 'assistant',
        toolCalls: [
          { id: 'call-1', name: 'commit_source', arguments: '{"message":"save"}' },
        ],
      },
      { role: 'tool', toolCallId: 'call-1', content: '{"value":"git.commit:ok"}' },
    ])
  })

  it('returns cloned replay messages that callers cannot mutate', () => {
    const driver = createDriver([])
    const first = driver.replayMessages
    first[0] = { role: 'user', content: 'changed' }

    expect(driver.replayMessages).toEqual([{ role: 'user', content: 'current request' }])
  })
})
