// @vitest-environment node

import { describe, expect, it } from 'vite-plus/test'
import { VirtualEditingWorkspace, VirtualFilesError } from './virtual-files'

function createWorkspace(): VirtualEditingWorkspace {
  return new VirtualEditingWorkspace({
    sourceRevision: 12,
    files: [
      { path: 'manifest.json', content: '{\n  "main": "sequences/main.sequence.json"\n}' },
      { path: 'sequences/main.sequence.json', content: '{\n  "segments": ["opening"]\n}' },
      { path: 'segments/opening.segment.json', content: '{\n  "label": "Opening"\n}' },
      { path: 'media/index.json', content: '{\n  "items": []\n}' },
      { path: 'evidence/transcripts/camera-1.json', content: '{\n  "text": "Hello Luna"\n}' },
    ],
  })
}

function expectErrorCode(action: () => unknown, code: string): void {
  try {
    action()
  } catch (error) {
    expect(error).toBeInstanceOf(VirtualFilesError)
    expect((error as VirtualFilesError).code).toBe(code)
    return
  }
  throw new Error(`Expected ${code}`)
}

describe('VirtualEditingWorkspace', () => {
  it('lists the module roots without loading file contents', () => {
    const workspace = createWorkspace()

    const rootEntries = [
      { path: 'components', type: 'directory', kind: 'components' },
      { path: 'evidence', type: 'directory', kind: 'evidence' },
      { path: 'manifest.json', type: 'file', kind: 'manifest', size: 44 },
      { path: 'media', type: 'directory', kind: 'media' },
      { path: 'segments', type: 'directory', kind: 'segments' },
      { path: 'sequences', type: 'directory', kind: 'sequences' },
      { path: 'tests', type: 'directory', kind: 'tests' },
    ]
    expect(workspace.list().entries).toEqual(rootEntries)
    expect(workspace.list({ path: '.' }).entries).toEqual(rootEntries)
    expect(workspace.list({ path: 'evidence', recursive: true }).entries).toEqual([
      { path: 'evidence/transcripts', type: 'directory', kind: 'evidence' },
      { path: 'evidence/transcripts/camera-1.json', type: 'file', kind: 'evidence', size: 26 },
    ])
  })

  it('reads individual files and reports the workspace revision', () => {
    const workspace = createWorkspace()

    expect(workspace.read('segments/opening.segment.json')).toMatchObject({
      path: 'segments/opening.segment.json',
      kind: 'segments',
      content: '{\n  "label": "Opening"\n}',
      revision: 0,
    })
  })

  it('searches lazily by path and paginates matches', () => {
    const workspace = createWorkspace()

    expect(workspace.search({ query: 'luna', path: 'evidence', limit: 1 })).toEqual({
      matches: [
        {
          path: 'evidence/transcripts/camera-1.json',
          line: 2,
          column: 18,
          preview: '  "text": "Hello Luna"',
        },
      ],
    })
    expect(workspace.search({ query: 'opening', limit: 1 })).toMatchObject({ nextCursor: 1 })
  })

  it('applies write, replace, and delete operations atomically', () => {
    const workspace = createWorkspace()

    const result = workspace.applyPatch({
      expectedRevision: 0,
      operations: [
        {
          op: 'replace',
          path: 'segments/opening.segment.json',
          oldText: 'Opening',
          newText: 'Cold open',
        },
        { op: 'write', path: 'components/title.component.json', content: '{"type":"title"}' },
        { op: 'delete', path: 'media/index.json' },
      ],
    })

    expect(result).toEqual({
      changed: true,
      revision: 1,
      changes: [
        { path: 'components/title.component.json', status: 'created' },
        { path: 'media/index.json', status: 'deleted' },
        { path: 'segments/opening.segment.json', status: 'modified' },
      ],
    })
    expect(workspace.read('segments/opening.segment.json').content).toContain('Cold open')
    expect(workspace.status().dirty).toBe(true)
  })

  it('does not leave partial changes when a later patch operation fails', () => {
    const workspace = createWorkspace()

    expectErrorCode(
      () =>
        workspace.applyPatch({
          operations: [
            { op: 'write', path: 'segments/new.segment.json', content: '{}' },
            {
              op: 'replace',
              path: 'segments/opening.segment.json',
              oldText: 'missing',
              newText: 'value',
            },
          ],
        }),
      'REPLACE_TEXT_NOT_FOUND',
    )

    expectErrorCode(() => workspace.read('segments/new.segment.json'), 'FILE_NOT_FOUND')
    expect(workspace.status()).toMatchObject({ revision: 0, dirty: false, changes: [] })
  })

  it('rejects stale revisions and guarded content changes', () => {
    const workspace = createWorkspace()
    workspace.applyPatch({
      operations: [{ op: 'write', path: 'tests/main.acceptance.json', content: '{}' }],
    })

    expectErrorCode(
      () =>
        workspace.applyPatch({
          expectedRevision: 0,
          operations: [{ op: 'write', path: 'tests/second.acceptance.json', content: '{}' }],
        }),
      'REVISION_CONFLICT',
    )
    expectErrorCode(
      () =>
        workspace.applyPatch({
          operations: [
            {
              op: 'write',
              path: 'manifest.json',
              expectedContent: 'stale content',
              content: '{}',
            },
          ],
        }),
      'CONTENT_CONFLICT',
    )
  })

  it('tracks dirty files against a clean checkpoint', () => {
    const workspace = createWorkspace()
    workspace.applyPatch({ operations: [{ op: 'write', path: 'manifest.json', content: '{}' }] })

    workspace.markClean(13)

    expect(workspace.status()).toEqual({
      sourceRevision: 13,
      revision: 1,
      dirty: false,
      changes: [],
    })
  })

  it('refreshes read-only evidence without replacing dirty source files', () => {
    const workspace = createWorkspace()
    workspace.applyPatch({
      operations: [{ op: 'write', path: 'manifest.json', content: '{"intent":"updated"}' }],
    })

    workspace.refreshReadOnlyProjection(8, [
      { path: 'media/index.json', content: '{"items":["new"]}' },
      { path: 'evidence/timeline/sequence.json', content: '{"baselineRevision":8}' },
    ])

    expect(workspace.sourceRevision).toBe(8)
    expect(workspace.read('manifest.json').content).toBe('{"intent":"updated"}')
    expect(workspace.read('media/index.json').content).toBe('{"items":["new"]}')
    expect(workspace.read('evidence/timeline/sequence.json').content)
      .toBe('{"baselineRevision":8}')
    expect(workspace.status().changes).toEqual([{ path: 'manifest.json', status: 'modified' }])
  })

  it('does not allow a projection refresh to overwrite editing source', () => {
    const workspace = createWorkspace()

    expectErrorCode(
      () => workspace.refreshReadOnlyProjection(8, [{ path: 'manifest.json', content: '{}' }]),
      'INVALID_PATH',
    )
  })

  it('rejects traversal, absolute, non-module, and non-JSON paths', () => {
    for (const path of [
      '../project.json',
      '/segments/opening.json',
      'segments/../manifest.json',
      'unknown/file.json',
      'segments/notes.txt',
      'segments\\opening.json',
    ]) {
      expectErrorCode(() => createWorkspace().read(path), 'INVALID_PATH')
    }
  })

  it('requires an unambiguous replace unless replaceAll is explicit', () => {
    const workspace = createWorkspace()
    workspace.applyPatch({
      operations: [{ op: 'write', path: 'tests/repeated.json', content: 'x x' }],
    })

    expectErrorCode(
      () =>
        workspace.applyPatch({
          operations: [{ op: 'replace', path: 'tests/repeated.json', oldText: 'x', newText: 'y' }],
        }),
      'REPLACE_TEXT_AMBIGUOUS',
    )

    workspace.applyPatch({
      operations: [
        {
          op: 'replace',
          path: 'tests/repeated.json',
          oldText: 'x',
          newText: 'y',
          replaceAll: true,
        },
      ],
    })
    expect(workspace.read('tests/repeated.json').content).toBe('y y')
  })
})
