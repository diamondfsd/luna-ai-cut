import { describe, expect, it } from 'vite-plus/test'
import type { EditProgram } from '../edit-program/types'
import { runTimelineAcceptance, timelineAcceptanceSchema } from './acceptance'
import { VirtualEditingWorkspace, type VirtualFileInput } from './virtual-files'

function json(value: unknown): string {
  return JSON.stringify(value)
}

function workspace(files: VirtualFileInput[] = []): VirtualEditingWorkspace {
  return new VirtualEditingWorkspace({ sourceRevision: 3, files })
}

const program: EditProgram = {
  version: 1,
  baseRevision: 3,
  intent: 'Build an accepted sequence',
  operations: [
    {
      type: 'insertClip',
      clip: { ref: 'a', mediaRef: 'media:a', trackRef: 'track:v1', start: 0, duration: 10 },
    },
    {
      type: 'insertClip',
      clip: { ref: 'b', mediaRef: 'media:b', trackRef: 'track:v1', start: 8, duration: 7 },
    },
    { type: 'insertText', text: { ref: 'title', text: 'Luna Luna', start: 2, duration: 3 } },
    { type: 'updateClip', clipRef: 'clip:old-title', changes: { text: 'Ending' } },
  ],
}

describe('timeline acceptance', () => {
  it('succeeds after measuring a build when no acceptance file exists', () => {
    expect(runTimelineAcceptance(workspace(), program)).toMatchObject({
      passed: true,
      files: [],
      results: [],
      diagnostics: [],
      metrics: {
        operationCount: 4,
        operationTypes: { insertClip: 2, insertText: 1, updateClip: 1 },
        outputDurationSeconds: 15,
        changedDurationSeconds: 15,
        textValueCount: 2,
      },
    })
  })

  it('runs count, type, duration, and required-text assertions', () => {
    const result = runTimelineAcceptance(
      workspace([
        {
          path: 'tests/main.acceptance.json',
          content: json({
            version: 1,
            name: 'main sequence',
            assertions: [
              { id: 'ops', kind: 'operationCount', min: 4, max: 5 },
              { id: 'shots', kind: 'operationType', operation: 'insertClip', min: 2 },
              { id: 'output', kind: 'outputDuration', minSeconds: 14, maxSeconds: 16 },
              { id: 'changed', kind: 'changedDuration', minSeconds: 15, maxSeconds: 15 },
              { id: 'title', kind: 'requiredText', text: 'luna', minOccurrences: 2 },
              { id: 'ending', kind: 'requiredText', text: 'Ending', caseSensitive: true },
            ],
          }),
        },
      ]),
      program,
    )

    expect(result.passed).toBe(true)
    expect(result.results).toHaveLength(6)
    expect(result.results.every((assertion) => assertion.passed)).toBe(true)
    expect(result.results.at(-2)).toMatchObject({ assertionId: 'title', actual: 2 })
    expect(result.diagnostics).toEqual([])
  })

  it('returns one structured result and diagnostic for each failed assertion', () => {
    const result = runTimelineAcceptance(
      workspace([
        {
          path: 'tests/failing.acceptance.json',
          content: json({
            version: 1,
            assertions: [
              { id: 'short-output', kind: 'outputDuration', maxSeconds: 12 },
              { id: 'missing-text', kind: 'requiredText', text: 'Not present' },
            ],
          }),
        },
      ]),
      program,
    )

    expect(result.passed).toBe(false)
    expect(result.results).toEqual([
      expect.objectContaining({ assertionId: 'short-output', passed: false, actual: 15 }),
      expect.objectContaining({ assertionId: 'missing-text', passed: false, actual: 0 }),
    ])
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'ACCEPTANCE_ASSERTION_FAILED',
        stage: 'test',
        path: 'tests/failing.acceptance.json',
        details: expect.objectContaining({ assertionId: 'short-output', actual: 15 }),
      }),
      expect.objectContaining({
        code: 'ACCEPTANCE_ASSERTION_FAILED',
        details: expect.objectContaining({ assertionId: 'missing-text', actual: 0 }),
      }),
    ])
  })

  it('reports invalid JSON and schema errors without throwing', () => {
    const result = runTimelineAcceptance(
      workspace([
        { path: 'tests/a.acceptance.json', content: '{' },
        {
          path: 'tests/b.acceptance.json',
          content: json({
            version: 1,
            assertions: [{ id: 'unbounded', kind: 'operationCount' }],
          }),
        },
      ]),
      program,
    )

    expect(result.passed).toBe(false)
    expect(result.diagnostics).toEqual([
      expect.objectContaining({ code: 'ACCEPTANCE_PARSE_ERROR', path: 'tests/a.acceptance.json' }),
      expect.objectContaining({
        code: 'ACCEPTANCE_SCHEMA_INVALID',
        path: 'tests/b.acceptance.json',
      }),
    ])
  })

  it('requires unique ids and bounded assertions in the schema', () => {
    expect(
      timelineAcceptanceSchema.safeParse({
        version: 1,
        assertions: [
          { id: 'same', kind: 'operationCount', min: 2 },
          { id: 'same', kind: 'changedDuration', minSeconds: 5 },
        ],
      }).success,
    ).toBe(false)
    expect(
      timelineAcceptanceSchema.safeParse({
        version: 1,
        assertions: [{ id: 'range', kind: 'outputDuration', minSeconds: 20, maxSeconds: 10 }],
      }).success,
    ).toBe(false)
  })
})
