import assert from 'node:assert/strict'

import { resolveWorkspaceVideoExportRange } from '../src/workspace/shared/workspaceExportRange.ts'

assert.deepEqual(
  resolveWorkspaceVideoExportRange(5, 15, 2, 8, true),
  { startTime: 7, endTime: 13 },
  'dialog trim must be relative to the existing workspace range',
)

assert.deepEqual(
  resolveWorkspaceVideoExportRange(5, 15, 20, 1, true),
  { startTime: 14.9, endTime: 15 },
  'dialog trim must stay inside the planned range and retain a minimum duration',
)

assert.deepEqual(
  resolveWorkspaceVideoExportRange(5, 15, 2, 8, false),
  { startTime: 5, endTime: 15 },
  'multi-video plans must preserve each planned range',
)

console.log('workspace export range tests passed')
