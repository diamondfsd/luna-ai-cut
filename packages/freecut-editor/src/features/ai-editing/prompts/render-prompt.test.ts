// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { renderPrompt } from './render-prompt'

describe('renderPrompt', () => {
  it('replaces declared prompt values', () => {
    expect(renderPrompt('State: {{STATE}}', { STATE: '{"revision":2}' }))
      .toBe('State: {"revision":2}')
  })

  it('rejects missing prompt values', () => {
    expect(() => renderPrompt('{{KNOWN}} {{MISSING}}', { KNOWN: 'ready' }))
      .toThrow('Missing prompt value: MISSING')
  })
})
