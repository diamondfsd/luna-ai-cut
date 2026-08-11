// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { SourceCompilerError, compileEditingSources } from './source-compiler'
import { VirtualEditingWorkspace, type VirtualFileInput } from './virtual-files'

function json(path: string, value: unknown): VirtualFileInput {
  return { path, content: JSON.stringify(value, null, 2) }
}

function workspace(files: VirtualFileInput[]): VirtualEditingWorkspace {
  return new VirtualEditingWorkspace({
    sourceRevision: 8,
    files: [
      json('manifest.json', {
        version: 1,
        main: 'sequences/main.sequence.json',
        intent: 'Build a modular launch film',
      }),
      ...files,
    ],
  })
}

function clip(ref: string, start: number): Record<string, unknown> {
  return {
    type: 'insertClip',
    clip: {
      ref,
      mediaRef: `media:${ref}`,
      trackRef: 'track:video-1',
      start,
      duration: 2,
    },
  }
}

function expectCompilerError(action: () => unknown, code: string): void {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(SourceCompilerError)
    expect((error as SourceCompilerError).code).toBe(code)
    return
  }
  throw new Error(`Expected ${code}`)
}

describe('compileEditingSources', () => {
  it('combines ordered segment modules into one multi-shot edit program', () => {
    const sources = workspace([
      json('sequences/main.sequence.json', {
        version: 1,
        imports: ['segments/opening.segment.json', 'segments/result.segment.json'],
      }),
      json('segments/opening.segment.json', {
        version: 1,
        operations: [clip('shot-1', 0), clip('shot-2', 2)],
      }),
      json('segments/result.segment.json', {
        version: 1,
        operations: [clip('shot-3', 4)],
      }),
    ])

    const program = compileEditingSources({ workspace: sources, baseRevision: 19, mode: 'preview' })

    expect(program).toMatchObject({
      version: 1,
      baseRevision: 19,
      intent: 'Build a modular launch film',
      mode: 'preview',
    })
    expect(program.operations.map((operation) => operation.type)).toEqual([
      'insertClip',
      'insertClip',
      'insertClip',
    ])
  })

  it('expands text component defaults while preserving local overrides', () => {
    const sources = workspace([
      json('sequences/main.sequence.json', {
        version: 1,
        imports: ['segments/opening.segment.json'],
      }),
      json('components/hero-title.component.json', {
        version: 1,
        type: 'text',
        role: 'title',
        style: { fontSize: 64, color: '#ffffff', fontWeight: 'bold' },
        box: { left: 0.1, top: 0.1, width: 0.8, height: 0.2 },
      }),
      json('segments/opening.segment.json', {
        version: 1,
        operations: [
          {
            type: 'insertText',
            text: {
              componentRef: 'components/hero-title.component.json',
              ref: 'title-1',
              text: 'Luna Ultra',
              start: 0,
              duration: 2,
              style: { color: '#0066cc' },
            },
          },
        ],
      }),
    ])

    const program = compileEditingSources({ workspace: sources, baseRevision: 8 })
    const operation = program.operations[0]

    expect(operation).toEqual({
      type: 'insertText',
      text: {
        ref: 'title-1',
        text: 'Luna Ultra',
        start: 0,
        duration: 2,
        role: 'title',
        style: { fontSize: 64, color: '#0066cc', fontWeight: 'bold' },
        box: { left: 0.1, top: 0.1, width: 0.8, height: 0.2 },
      },
    })
    expect(JSON.stringify(operation)).not.toContain('componentRef')
  })

  it('reports a missing segment reference', () => {
    const sources = workspace([
      json('sequences/main.sequence.json', {
        version: 1,
        imports: ['segments/missing.segment.json'],
      }),
    ])

    expectCompilerError(
      () => compileEditingSources({ workspace: sources, baseRevision: 8 }),
      'MISSING_REFERENCE',
    )
  })

  it('reports a missing component reference', () => {
    const sources = workspace([
      json('sequences/main.sequence.json', {
        version: 1,
        imports: ['segments/opening.segment.json'],
      }),
      json('segments/opening.segment.json', {
        version: 1,
        operations: [
          {
            type: 'insertText',
            text: {
              componentRef: 'components/missing.component.json',
              ref: 'title-1',
              text: 'Title',
              start: 0,
              duration: 2,
            },
          },
        ],
      }),
    ])

    expectCompilerError(
      () => compileEditingSources({ workspace: sources, baseRevision: 8 }),
      'MISSING_REFERENCE',
    )
  })

  it('reports import cycles before treating a segment as duplicated', () => {
    const sources = workspace([
      json('sequences/main.sequence.json', {
        version: 1,
        imports: ['segments/a.segment.json'],
      }),
      json('segments/a.segment.json', {
        version: 1,
        imports: ['segments/b.segment.json'],
        operations: [],
      }),
      json('segments/b.segment.json', {
        version: 1,
        imports: ['segments/a.segment.json'],
        operations: [],
      }),
    ])

    expectCompilerError(
      () => compileEditingSources({ workspace: sources, baseRevision: 8 }),
      'IMPORT_CYCLE',
    )
  })

  it('rejects duplicate segment imports', () => {
    const sources = workspace([
      json('sequences/main.sequence.json', {
        version: 1,
        imports: ['segments/shared.segment.json', 'segments/shared.segment.json'],
      }),
      json('segments/shared.segment.json', {
        version: 1,
        operations: [clip('shot-1', 0)],
      }),
    ])

    expectCompilerError(
      () => compileEditingSources({ workspace: sources, baseRevision: 8 }),
      'DUPLICATE_SEGMENT',
    )
  })

  it('forbids baseRevision in source files', () => {
    const sources = new VirtualEditingWorkspace({
      sourceRevision: 8,
      files: [
        json('manifest.json', {
          version: 1,
          main: 'sequences/main.sequence.json',
          intent: 'Invalid source',
          baseRevision: 8,
        }),
        json('sequences/main.sequence.json', {
          version: 1,
          imports: ['segments/opening.segment.json'],
        }),
        json('segments/opening.segment.json', {
          version: 1,
          operations: [clip('shot-1', 0)],
        }),
      ],
    })

    expectCompilerError(
      () => compileEditingSources({ workspace: sources, baseRevision: 9 }),
      'SOURCE_VALIDATION_ERROR',
    )
  })

  it('compiles a modular project with more than one hundred operations', () => {
    const segmentPaths = ['segments/part-a.segment.json', 'segments/part-b.segment.json']
    const sources = workspace([
      json('sequences/main.sequence.json', { version: 1, imports: segmentPaths }),
      ...segmentPaths.map((path, segmentIndex) =>
        json(path, {
          version: 1,
          operations: Array.from({ length: 75 }, (_, index) =>
            clip(`shot-${segmentIndex}-${index}`, segmentIndex * 75 + index),
          ),
        }),
      ),
    ])

    expect(compileEditingSources({ workspace: sources, baseRevision: 8 }).operations).toHaveLength(
      150,
    )
  })
})
