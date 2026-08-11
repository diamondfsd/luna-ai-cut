import type { AgentClip, AgentWorkspaceDocument } from '../edit-program/types'
import type { VirtualFileInput } from './virtual-files'

const MAX_CLIPS_PER_SEGMENT = 80

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function safeRefId(ref: string): string {
  const separator = ref.indexOf(':')
  const value = separator >= 0 ? ref.slice(separator + 1) : ref
  const safe = value.replaceAll(/[^a-zA-Z0-9_-]/g, '-')
  return safe || 'unknown'
}

function mediaIdFromRef(ref: string): string {
  const prefix = 'media:'
  if (!ref.startsWith(prefix) || ref.length === prefix.length) {
    throw new Error(`素材引用“${ref}”格式无效。`)
  }
  return ref.slice(prefix.length)
}

function assignMediaFileIds(workspace: AgentWorkspaceDocument): Map<string, string> {
  const result = new Map<string, string>()
  const used = new Set<string>()
  for (const media of workspace.media) {
    const base = safeRefId(media.ref)
    let candidate = base
    let suffix = 2
    while (used.has(candidate)) {
      candidate = `${base}-${suffix}`
      suffix += 1
    }
    used.add(candidate)
    result.set(media.ref, candidate)
  }
  return result
}

function segmentRange(clips: readonly AgentClip[]): { start: number; end: number } {
  return clips.reduce(
    (range, clip) => ({
      start: Math.min(range.start, clip.start),
      end: Math.max(range.end, clip.start + clip.duration),
    }),
    { start: Number.POSITIVE_INFINITY, end: 0 },
  )
}

function chunkClips(clips: readonly AgentClip[]): AgentClip[][] {
  const sorted = clips.toSorted(
    (left, right) => left.start - right.start || left.trackRef.localeCompare(right.trackRef),
  )
  const chunks: AgentClip[][] = []
  for (let offset = 0; offset < sorted.length; offset += MAX_CLIPS_PER_SEGMENT) {
    chunks.push(sorted.slice(offset, offset + MAX_CLIPS_PER_SEGMENT))
  }
  return chunks
}

export function projectAgentWorkspaceToFiles(
  workspace: AgentWorkspaceDocument,
): VirtualFileInput[] {
  const files: VirtualFileInput[] = []
  const segmentFiles = chunkClips(workspace.clips).map((clips, index) => {
    const range = segmentRange(clips)
    const path = `evidence/timeline/current-${String(index + 1).padStart(4, '0')}.json`
    const clipRefs = new Set(clips.map((clip) => clip.ref))
    const transitions = workspace.transitions.filter((transition) =>
      transition.between.some((clipRef) => clipRefs.has(clipRef)),
    )
    files.push({
      path,
      content: json({
        version: 1,
        kind: 'timeline-snapshot-segment',
        readOnly: true,
        range,
        clips,
        transitions,
      }),
    })
    return { path, range, clipCount: clips.length }
  })

  files.push({
    path: 'manifest.json',
    content: json({
      version: 1,
      main: 'sequences/main.sequence.json',
      intent: '基于当前项目完成用户要求的剪辑',
    }),
  })
  files.push({
    path: 'sequences/main.sequence.json',
    content: json({ version: 1, imports: ['segments/main.segment.json'] }),
  })
  files.push({
    path: 'segments/main.segment.json',
    content: json({ version: 1, operations: [] }),
  })
  files.push({
    path: 'evidence/timeline/sequence.json',
    content: json({
      version: 1,
      kind: 'timeline-snapshot-sequence',
      readOnly: true,
      baselineRevision: workspace.revision,
      project: workspace.project,
      tracks: workspace.tracks,
      segments: segmentFiles,
      counts: {
        tracks: workspace.tracks.length,
        clips: workspace.clips.length,
        transitions: workspace.transitions.length,
        media: workspace.media.length,
      },
    }),
  })

  const mediaFileIds = assignMediaFileIds(workspace)
  const mediaIndex = workspace.media.map((media) => ({
    id: mediaIdFromRef(media.ref),
    ref: media.ref,
    name: media.name,
    kind: media.kind,
    duration: media.duration,
    width: media.width,
    height: media.height,
    hasAudio: media.hasAudio,
    detail: `media/${mediaFileIds.get(media.ref)}.json`,
  }))
  files.push({ path: 'media/index.json', content: json({ version: 1, items: mediaIndex }) })
  for (const media of workspace.media) {
    const id = mediaFileIds.get(media.ref)
    if (!id) continue
    files.push({
      path: `media/${id}.json`,
      content: json({
        version: 1,
        id: mediaIdFromRef(media.ref),
        ref: media.ref,
        name: media.name,
        kind: media.kind,
        duration: media.duration,
        width: media.width,
        height: media.height,
        hasAudio: media.hasAudio,
        audioAnalysis: media.evidence.audioAnalysis,
        visualEvidence: `evidence/visual/${id}.json`,
        ...(media.evidence.transcript
          ? { transcriptEvidence: `evidence/transcripts/${id}.json` }
          : {}),
      }),
    })
    files.push({
      path: `evidence/visual/${id}.json`,
      content: json({ version: 1, mediaRef: media.ref, samples: media.evidence.visual }),
    })
    if (media.evidence.transcript) {
      files.push({
        path: `evidence/transcripts/${id}.json`,
        content: json({ version: 1, mediaRef: media.ref, ...media.evidence.transcript }),
      })
    }
  }
  return files.sort((left, right) => left.path.localeCompare(right.path))
}

export { MAX_CLIPS_PER_SEGMENT }
