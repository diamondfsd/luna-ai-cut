// @vitest-environment node

import { afterEach, describe, expect, it } from 'vite-plus/test'
import '../test-utils/logger-test-mocks'

import { setWorkspaceRoot } from './root'
import { asHandle, createRoot } from './__tests__/in-memory-handle'
import { getEditingEvidence, saveVisualEditingEvidence } from './editing-evidence'

afterEach(() => setWorkspaceRoot(null))

describe('editing evidence storage', () => {
  it('persists compact visual evidence with its source fingerprint', async () => {
    setWorkspaceRoot(asHandle(createRoot()))

    await saveVisualEditingEvidence('media-1', '1024:123', {
      models: [{ id: 'yolo26s-seg', version: 'v1' }],
      samples: [{ timeSeconds: 1.5, tags: ['人物', '室内'] }],
      intensity: 'strong',
    })

    await expect(getEditingEvidence('media-1')).resolves.toEqual({
      sourceFingerprint: '1024:123',
      visual: {
        models: [{ id: 'yolo26s-seg', version: 'v1' }],
        samples: [{ timeSeconds: 1.5, tags: ['人物', '室内'] }],
        intensity: 'strong',
      },
    })
  })
})
