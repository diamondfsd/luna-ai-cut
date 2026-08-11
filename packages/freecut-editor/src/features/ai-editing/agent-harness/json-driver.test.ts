import { describe, expect, it } from 'vite-plus/test'
import type { LlmAdapter } from '@freecut/infrastructure/llm'
import { JsonAgentDriver } from './json-driver'

const adapter: LlmAdapter = {
  id: 'test-json',
  label: 'Test JSON adapter',
  isSupported: () => true,
  load: async () => undefined,
  generate: async () => '{"reply":"done","toolCalls":[]}',
  dispose: () => undefined,
}

describe('JsonAgentDriver replay transcript', () => {
  it('exports only the current turn and preserves the raw final response', async () => {
    const driver = new JsonAgentDriver({
      adapter,
      messages: [
        { role: 'system', content: 'system' },
        { role: 'assistant', content: 'old answer' },
        { role: 'user', content: 'current request' },
      ],
      replayFromIndex: 2,
      parse: () => ({ reply: 'done', toolCalls: [] }),
      renderToolResults: () => '',
      requestOptions: () => ({}),
    })

    const step = await driver.request({ round: 0 })
    if (step.kind !== 'output') throw new Error('Expected model output')
    driver.recordFinalOutput(step.output)

    expect(driver.replayMessages).toEqual([
      { role: 'user', content: 'current request' },
      { role: 'assistant', content: '{"reply":"done","toolCalls":[]}' },
    ])
  })
})
