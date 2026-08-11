import type { Project, ProjectTimeline } from '@freecut/types/project'
import {
  PROJECT_SOURCE_MAX_CLIPS_PER_SEGMENT,
  PROJECT_SOURCE_SEGMENT_SECONDS,
  PROJECT_SOURCE_VERSION,
  type AnimationsSource,
  type ClipSegmentSource,
  type ComponentIndexSource,
  type ComponentSource,
  type ProjectManifestSource,
  type ProjectSourceClip,
  type SequencePartsSource,
  type SequenceSource,
  type TrackSource,
  type TransitionsSource,
} from './project-source-schema'
import {
  isNormalizedTextAnchor,
  isNormalizedTextBox,
  normalizedTextBoxFromTransform,
  transformFromNormalizedTextBox,
} from './normalized-text-layout'

interface SourceReader {
  read(path: string): Promise<string>
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`
}

function omitObjectKeys<T extends object, K extends keyof T>(
  value: T,
  keys: readonly K[],
): Omit<T, K> {
  const result: Partial<T> = { ...value }
  for (const key of keys) delete result[key]
  return result as Omit<T, K>
}

function sourceKey(id: string): string {
  return `id-${encodeURIComponent(id)}`
}

function segmentPage(value: number): string {
  return String(value).padStart(6, '0')
}

function parseObject(content: string, path: string): Record<string, unknown> {
  let value: unknown
  try {
    value = JSON.parse(content)
  } catch {
    throw new Error(`工程源码无法解析：${path}`)
  }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`工程源码内容无效：${path}`)
  }
  return value as Record<string, unknown>
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== 'string')) {
    throw new Error(`工程源码引用无效：${path}`)
  }
  return value as string[]
}

interface SourceCanvas {
  width: number
  height: number
  fps: number
}

const TEXT_LAYOUT_TRANSFORM_FIELDS = [
  'x', 'y', 'width', 'height', 'anchorX', 'anchorY',
] as const

function sourceClipFromProject(
  clip: ProjectTimeline['items'][number],
  canvas: SourceCanvas,
): ProjectSourceClip {
  if (clip.type !== 'text') return clip as unknown as ProjectSourceClip
  const { transform, ...rest } = clip
  const presentationTransform = omitObjectKeys(
    transform ?? {},
    TEXT_LAYOUT_TRANSFORM_FIELDS,
  )
  const textBox = normalizedTextBoxFromTransform(transform, canvas)
  if (!isNormalizedTextBox(textBox)) {
    throw new Error(`文字“${clip.label}”的文字框必须完整位于画布范围内。`)
  }
  const textAnchor = transform?.anchorX !== undefined || transform?.anchorY !== undefined
    ? {
        x: (transform.anchorX ?? (transform.width ?? canvas.width) / 2) /
          (transform.width ?? canvas.width),
        y: (transform.anchorY ?? (transform.height ?? canvas.height) / 2) /
          (transform.height ?? canvas.height),
      }
    : undefined
  if (textAnchor && !isNormalizedTextAnchor(textAnchor)) {
    throw new Error(`文字“${clip.label}”的旋转锚点必须位于文字框范围内。`)
  }
  return {
    ...rest,
    textBox,
    ...(textAnchor ? { textAnchor } : {}),
    ...(Object.keys(presentationTransform).length > 0
      ? { transform: presentationTransform }
      : {}),
  } as ProjectSourceClip
}

function projectClipFromSource(
  clip: Record<string, unknown>,
  canvas: SourceCanvas,
  path: string,
): ProjectTimeline['items'][number] {
  if (clip.type !== 'text') {
    if ('textBox' in clip) throw new Error(`只有文字片段可以使用 textBox：${path}`)
    return clip as ProjectTimeline['items'][number]
  }
  if (!isNormalizedTextBox(clip.textBox)) {
    throw new Error(`文字片段的 textBox 必须使用 0 到 1 的画布归一化坐标：${path}`)
  }
  if ('textAnchor' in clip && !isNormalizedTextAnchor(clip.textAnchor)) {
    throw new Error(`文字片段的 textAnchor 必须使用 0 到 1 的文字框归一化坐标：${path}`)
  }
  if ('transform' in clip && !isObject(clip.transform)) {
    throw new Error(`文字片段的 transform 必须是对象：${path}`)
  }
  const sourceTransform = clip.transform
  if (isObject(sourceTransform)) {
    const layoutField = TEXT_LAYOUT_TRANSFORM_FIELDS.find((field) => field in sourceTransform)
    if (layoutField) {
      throw new Error(
        `文字片段不能使用 transform.${layoutField}：请改用 0 到 1 的 textBox：${path}`,
      )
    }
  }
  const { textBox, textAnchor, transform, ...rest } = clip
  const layoutTransform = transformFromNormalizedTextBox(textBox, canvas)
  return {
    ...rest,
    transform: {
      ...(isObject(transform) ? transform : {}),
      ...layoutTransform,
      ...(isNormalizedTextAnchor(textAnchor)
        ? {
            anchorX: textAnchor.x * layoutTransform.width,
            anchorY: textAnchor.y * layoutTransform.height,
          }
        : {}),
    },
  } as ProjectTimeline['items'][number]
}

function splitSequence(
  root: string,
  id: string,
  timeline: ProjectTimeline,
  canvas: SourceCanvas,
): Record<string, string> {
  const files: Record<string, string> = {}
  const trackPaths = timeline.tracks.map((track) => {
    const trackRoot = `${root}/tracks/${sourceKey(track.id)}`
    const path = `${trackRoot}/track.json`
    const windows = new Map<number, ProjectTimeline['items']>()
    const windowFrames = Math.max(1, Math.round(canvas.fps * PROJECT_SOURCE_SEGMENT_SECONDS))
    for (const clip of timeline.items.filter((item) => item.trackId === track.id)) {
      const window = Math.max(0, Math.floor(clip.from / windowFrames))
      windows.set(window, [...(windows.get(window) ?? []), clip])
    }
    const segments: Array<{
      path: string
      startFrame: number
      endFrame: number
      clipCount: number
    }> = []
    for (const [window, clips] of [...windows].sort(([left], [right]) => left - right)) {
      const sorted = clips.toSorted(
        (left, right) => left.from - right.from || left.id.localeCompare(right.id),
      )
      for (let offset = 0; offset < sorted.length; offset += PROJECT_SOURCE_MAX_CLIPS_PER_SEGMENT) {
        const page = Math.floor(offset / PROJECT_SOURCE_MAX_CLIPS_PER_SEGMENT) + 1
        const pageClips = sorted.slice(offset, offset + PROJECT_SOURCE_MAX_CLIPS_PER_SEGMENT)
        const segmentPath = `${trackRoot}/segments/w${segmentPage(window)}-p${String(page).padStart(2, '0')}.json`
        const startFrame = pageClips.reduce(
          (minimum, clip) => Math.min(minimum, clip.from),
          Number.POSITIVE_INFINITY,
        )
        const endFrame = pageClips.reduce(
          (maximum, clip) => Math.max(maximum, clip.from + clip.durationInFrames),
          0,
        )
        files[segmentPath] = json({
          version: PROJECT_SOURCE_VERSION,
          kind: 'clip-segment',
          trackId: track.id,
          window,
          clips: pageClips.map((clip) => sourceClipFromProject(clip, canvas)),
        } satisfies ClipSegmentSource)
        segments.push({ path: segmentPath, startFrame, endFrame, clipCount: pageClips.length })
      }
    }
    files[path] = json({
      version: PROJECT_SOURCE_VERSION,
      kind: 'track',
      track,
      segments,
    } satisfies TrackSource)
    return path
  })
  const transitionsPath = `${root}/transitions.json`
  const animationsPath = `${root}/animations.json`
  files[transitionsPath] = json({
    version: PROJECT_SOURCE_VERSION,
    kind: 'transitions',
    transitions: timeline.transitions ?? [],
  } satisfies TransitionsSource)
  files[animationsPath] = json({
    version: PROJECT_SOURCE_VERSION,
    kind: 'animations',
    keyframes: timeline.keyframes ?? [],
  } satisfies AnimationsSource)
  const state = omitObjectKeys(timeline, [
    'tracks',
    'items',
    'transitions',
    'keyframes',
    'compositions',
    'topLevelSequenceIds',
  ])
  files[`${root}/sequence.json`] = json({
    version: PROJECT_SOURCE_VERSION,
    kind: 'sequence',
    id,
    state,
    tracks: trackPaths,
    transitions: transitionsPath,
    animations: animationsPath,
  } satisfies SequenceSource)
  return files
}

export function projectToSourceFiles(project: Project): Record<string, string> {
  const timeline = project.timeline ?? { tracks: [], items: [] }
  const files = splitSequence('sequences/main', 'main', timeline, project.metadata)
  const componentEntries: ComponentIndexSource['components'] = []

  for (const component of timeline.compositions ?? []) {
    const root = `components/${sourceKey(component.id)}`
    const componentTimeline: ProjectTimeline = {
      tracks: component.tracks,
      items: component.items,
      transitions: component.transitions,
      keyframes: component.keyframes,
    }
    const componentFiles = splitSequence(root, component.id, componentTimeline, component)
    Object.assign(files, componentFiles)
    const sequence = JSON.parse(componentFiles[`${root}/sequence.json`]!) as SequenceSource
    const state = omitObjectKeys(component, [
      'tracks',
      'items',
      'transitions',
      'keyframes',
    ])
    const componentPath = `${root}/component.json`
    files[componentPath] = json({
      version: PROJECT_SOURCE_VERSION,
      kind: 'component',
      id: component.id,
      state,
      tracks: sequence.tracks,
      transitions: sequence.transitions,
      animations: sequence.animations,
    } satisfies ComponentSource)
    delete files[`${root}/sequence.json`]
    componentEntries.push({ id: component.id, path: componentPath })
  }

  files['components/index.json'] = json({
    version: PROJECT_SOURCE_VERSION,
    kind: 'component-index',
    topLevelSequenceIds: timeline.topLevelSequenceIds ?? [],
    components: componentEntries,
  } satisfies ComponentIndexSource)
  files['manifest.json'] = json({
    version: PROJECT_SOURCE_VERSION,
    kind: 'freecut-project',
    project: {
      id: project.id,
      name: project.name,
      description: project.description,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
      duration: project.duration,
      schemaVersion: project.schemaVersion,
      metadata: project.metadata,
    },
    main: 'sequences/main/sequence.json',
    components: 'components/index.json',
  } satisfies ProjectManifestSource)
  return files
}

async function readSequenceParts(
  reader: SourceReader,
  source: SequencePartsSource,
  path: string,
  canvas: SourceCanvas,
): Promise<ProjectTimeline> {
  if (!isObject(source.state) || typeof source.transitions !== 'string' ||
    typeof source.animations !== 'string') {
    throw new Error(`工程序列结构无效：${path}`)
  }
  const tracks = [] as ProjectTimeline['tracks']
  const items = [] as ProjectTimeline['items']
  for (const trackPath of stringArray(source.tracks, path)) {
    const trackFile = parseObject(await reader.read(trackPath), trackPath)
    if (trackFile.version !== PROJECT_SOURCE_VERSION || trackFile.kind !== 'track' ||
      !isObject(trackFile.track) || typeof trackFile.track.id !== 'string' ||
      !Array.isArray(trackFile.segments)) {
      throw new Error(`工程轨道文件无效：${trackPath}`)
    }
    const track = trackFile.track as unknown as ProjectTimeline['tracks'][number]
    tracks.push(track)
    for (const segmentEntry of trackFile.segments) {
      if (!segmentEntry || typeof segmentEntry !== 'object' ||
        typeof (segmentEntry as { path?: unknown }).path !== 'string') {
        throw new Error(`工程片段索引无效：${trackPath}`)
      }
      const segmentPath = (segmentEntry as { path: string }).path
      const segment = parseObject(await reader.read(segmentPath), segmentPath)
      if (segment.version !== PROJECT_SOURCE_VERSION || segment.kind !== 'clip-segment' ||
        segment.trackId !== track.id || !Array.isArray(segment.clips)) {
        throw new Error(`工程片段文件无效：${segmentPath}`)
      }
      const invalidClip = segment.clips.find((clip) =>
        !isObject(clip) || typeof clip.id !== 'string' || clip.trackId !== track.id ||
        typeof clip.type !== 'string' || typeof clip.from !== 'number' ||
        !Number.isFinite(clip.from) || typeof clip.durationInFrames !== 'number' ||
        !Number.isFinite(clip.durationInFrames) || clip.durationInFrames <= 0,
      )
      if (invalidClip) throw new Error(`工程片段字段无效：${segmentPath}`)
      items.push(...segment.clips.map((clip) =>
        projectClipFromSource(clip as Record<string, unknown>, canvas, segmentPath),
      ))
    }
  }
  const transitionFile = parseObject(await reader.read(source.transitions), source.transitions)
  const animationFile = parseObject(await reader.read(source.animations), source.animations)
  if (!Array.isArray(transitionFile.transitions) || !Array.isArray(animationFile.keyframes)) {
    throw new Error(`工程序列附属文件无效：${path}`)
  }
  return {
    ...(source.state as unknown as ProjectTimeline),
    tracks,
    items,
    transitions: transitionFile.transitions as NonNullable<ProjectTimeline['transitions']>,
    keyframes: animationFile.keyframes as NonNullable<ProjectTimeline['keyframes']>,
  }
}

async function readSequence(
  reader: SourceReader,
  path: string,
  canvas: SourceCanvas,
): Promise<ProjectTimeline> {
  const source = parseObject(await reader.read(path), path) as unknown as SequenceSource
  if (source.version !== PROJECT_SOURCE_VERSION || source.kind !== 'sequence' ||
    typeof source.id !== 'string' || !Array.isArray(source.tracks)) {
    throw new Error(`工程序列版本无效：${path}`)
  }
  return readSequenceParts(reader, source, path, canvas)
}

export async function projectFromSourceFiles(reader: SourceReader): Promise<Project> {
  const manifest = parseObject(await reader.read('manifest.json'), 'manifest.json')
  if (manifest.version !== PROJECT_SOURCE_VERSION || manifest.kind !== 'freecut-project' ||
    !manifest.project || typeof manifest.project !== 'object' ||
    typeof manifest.main !== 'string' || typeof manifest.components !== 'string') {
    throw new Error('当前工作树不是可渲染的视频工程源码。')
  }
  const manifestProject = manifest.project as Project
  const timeline = await readSequence(reader, manifest.main, manifestProject.metadata)
  const indexPath = manifest.components
  const index = parseObject(await reader.read(indexPath), indexPath) as unknown as ComponentIndexSource
  if (index.version !== PROJECT_SOURCE_VERSION || index.kind !== 'component-index' ||
    !Array.isArray(index.components)) {
    throw new Error('工程合成索引无效。')
  }
  const topLevelSequenceIds = stringArray(index.topLevelSequenceIds, indexPath)
  const compositions: NonNullable<ProjectTimeline['compositions']> = []
  for (const entry of index.components) {
    if (!isObject(entry) || typeof entry.id !== 'string' || typeof entry.path !== 'string') {
      throw new Error(`工程合成引用无效：${indexPath}`)
    }
    const source = parseObject(await reader.read(entry.path), entry.path) as unknown as ComponentSource
    if (source.version !== PROJECT_SOURCE_VERSION || source.kind !== 'component' ||
      source.id !== entry.id || !isObject(source.state) || !Array.isArray(source.tracks)) {
      throw new Error(`工程合成文件无效：${entry.path}`)
    }
    const componentState = source.state as NonNullable<ProjectTimeline['compositions']>[number]
    const sequence = await readSequenceParts(reader, source, entry.path, componentState)
    compositions.push({
      ...(source.state as NonNullable<ProjectTimeline['compositions']>[number]),
      id: source.id,
      tracks: sequence.tracks,
      items: sequence.items,
      transitions: sequence.transitions,
      keyframes: sequence.keyframes,
    })
  }
  return {
    ...(manifest.project as Project),
    timeline: {
      ...timeline,
      ...(compositions.length > 0 ? { compositions } : {}),
      ...(topLevelSequenceIds.length > 0
        ? { topLevelSequenceIds }
        : {}),
    },
  }
}

export { PROJECT_SOURCE_VERSION } from './project-source-schema'
