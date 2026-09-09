import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { AiEditorMediaSource } from '../shared/aiEditor'
import type { WorkspaceMediaAsset } from '../shared/types'
import { WorkspaceImportDialog } from '../workspace/components/WorkspaceImportDialog'
import './AiEditorPage.css'

interface AiEditorLocationState {
  media?: AiEditorMediaSource[]
  view?: 'projects'
  entryId?: number
}

interface AiEditorPageProps {
  active: boolean
}

interface ChooseAssetsRequest {
  source: 'luna-openreel'
  type: 'choose-assets'
  requestId: string
  projectId: string
  existingPaths: string[]
}

function isChooseAssetsRequest(value: unknown): value is ChooseAssetsRequest {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<ChooseAssetsRequest>
  return message.source === 'luna-openreel'
    && message.type === 'choose-assets'
    && typeof message.requestId === 'string'
    && typeof message.projectId === 'string'
    && Array.isArray(message.existingPaths)
    && message.existingPaths.every((path) => typeof path === 'string')
}

function isMediaSource(value: unknown): value is AiEditorMediaSource {
  if (!value || typeof value !== 'object') return false
  const source = value as Partial<AiEditorMediaSource>
  return typeof source.path === 'string'
    && typeof source.name === 'string'
    && (source.kind === 'image' || source.kind === 'video')
}

function mediaSourcesFromState(value: unknown): AiEditorMediaSource[] {
  if (!value || typeof value !== 'object') return []
  const state = value as AiEditorLocationState
  return Array.isArray(state.media) ? state.media.filter(isMediaSource) : []
}

function isProjectListRequest(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false
  return (value as AiEditorLocationState).view === 'projects'
}

function postChooseAssetsResult(
  target: WindowProxy,
  request: ChooseAssetsRequest,
  assets: WorkspaceMediaAsset[],
): void {
  try {
    target.postMessage({
      source: 'luna-host',
      type: 'choose-assets-result',
      requestId: request.requestId,
      projectId: request.projectId,
      assets,
    }, '*')
  } catch (error) {
    console.error('[AI 剪辑] 返回素材选择结果失败', error)
  }
}

function fileUrlForPath(filePath: string): string {
  if (filePath.startsWith('file://')) return filePath
  const normalized = filePath.replace(/\\/g, '/')
  const pathWithLeadingSlash = normalized.startsWith('/') ? normalized : `/${normalized}`
  return `file://${pathWithLeadingSlash.split('/').map(encodeURIComponent).join('/')}`
}

function fileTypeForName(name: string, kind: AiEditorMediaSource['kind']): string {
  const extension = name.split('.').pop()?.toLowerCase()
  if (kind === 'image') {
    return extension === 'png' ? 'image/png' : extension === 'webp' ? 'image/webp' : 'image/jpeg'
  }
  if (extension === 'webm') return 'video/webm'
  if (extension === 'mov') return 'video/quicktime'
  return 'video/mp4'
}

async function waitForMediaInput(frame: HTMLIFrameElement): Promise<HTMLInputElement> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const input = frame.contentDocument?.querySelector<HTMLInputElement>('input[type="file"]')
    if (input) return input
    await new Promise((resolve) => window.setTimeout(resolve, 100))
  }
  throw new Error('OpenReel 素材面板未准备好')
}

async function importMediaIntoFrame(frame: HTMLIFrameElement, sources: AiEditorMediaSource[]): Promise<void> {
  const input = await waitForMediaInput(frame)
  const transfer = new DataTransfer()
  for (const source of sources) {
    const response = await fetch(fileUrlForPath(source.path))
    if (!response.ok) throw new Error(`无法读取 ${source.name}`)
    const blob = await response.blob()
    transfer.items.add(new File([blob], source.name, {
      type: blob.type || fileTypeForName(source.name, source.kind),
      lastModified: Date.now(),
    }))
  }
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

export function AiEditorPage({ active }: AiEditorPageProps) {
  const location = useLocation()
  const locationState = location.state
  const frameRef = useRef<HTMLIFrameElement>(null)
  const importStartedRef = useRef(false)
  const pendingChooseAssetsRef = useRef<ChooseAssetsRequest | null>(null)
  const pendingChooseAssetsTargetRef = useRef<WindowProxy | null>(null)
  const [editorView, setEditorView] = useState<{ mode: 'projects' | 'media'; media: AiEditorMediaSource[]; revision: number }>({
    mode: 'projects',
    media: [],
    revision: 0,
  })
  const [loaded, setLoaded] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importFailed, setImportFailed] = useState(false)
  const [chooseAssetsOpen, setChooseAssetsOpen] = useState(false)
  const [chooseAssetsExistingPaths, setChooseAssetsExistingPaths] = useState<string[]>([])

  useEffect(() => {
    if (!active) return
    const mediaSources = mediaSourcesFromState(locationState)
    const nextView = !isProjectListRequest(locationState) && mediaSources.length > 0
      ? { mode: 'media' as const, media: mediaSources }
      : { mode: 'projects' as const, media: [] }
    const pendingRequest = pendingChooseAssetsRef.current
    const pendingTarget = pendingChooseAssetsTargetRef.current
    if (pendingRequest && pendingTarget) postChooseAssetsResult(pendingTarget, pendingRequest, [])
    pendingChooseAssetsRef.current = null
    pendingChooseAssetsTargetRef.current = null
    setChooseAssetsOpen(false)
    setChooseAssetsExistingPaths([])
    importStartedRef.current = false
    setLoaded(false)
    setImporting(false)
    setImportFailed(false)
    setEditorView((previous) => ({
      ...nextView,
      revision: previous.revision + 1,
    }))
  }, [active, location.key, locationState])

  useEffect(() => {
    function handleMessage(event: MessageEvent<unknown>): void {
      const request = isChooseAssetsRequest(event.data) ? event.data : null
      if (!request) return
      if (event.source !== frameRef.current?.contentWindow) return

      const previousRequest = pendingChooseAssetsRef.current
      const previousTarget = pendingChooseAssetsTargetRef.current
      if (previousRequest && previousTarget) {
        postChooseAssetsResult(previousTarget, previousRequest, [])
      }
      pendingChooseAssetsRef.current = request
      pendingChooseAssetsTargetRef.current = event.source
      setChooseAssetsExistingPaths(request.existingPaths)
      setChooseAssetsOpen(true)
    }

    window.addEventListener('message', handleMessage)
    return () => {
      window.removeEventListener('message', handleMessage)
      const request = pendingChooseAssetsRef.current
      const target = pendingChooseAssetsTargetRef.current
      if (request && target) postChooseAssetsResult(target, request, [])
      pendingChooseAssetsRef.current = null
      pendingChooseAssetsTargetRef.current = null
    }
  }, [])

  function replyToChooseAssets(request: ChooseAssetsRequest, assets: WorkspaceMediaAsset[]): void {
    const target = pendingChooseAssetsTargetRef.current
    if (pendingChooseAssetsRef.current !== request || !target) return
    try {
      target.postMessage({
        source: 'luna-host',
        type: 'choose-assets-result',
        requestId: request.requestId,
        projectId: request.projectId,
        assets,
      }, '*')
    } catch (error) {
      console.error('[AI 剪辑] 返回素材选择结果失败', error)
    }
    pendingChooseAssetsRef.current = null
    pendingChooseAssetsTargetRef.current = null
    setChooseAssetsExistingPaths([])
  }

  async function enrichWorkspaceAssets(assets: WorkspaceMediaAsset[]): Promise<WorkspaceMediaAsset[]> {
    return Promise.all(assets.map(async (asset) => {
      const [resolution, duration] = await Promise.all([
        window.luna.workspace.getMediaResolution(asset.path).catch(() => null),
        asset.kind === 'video'
          ? window.luna.workspace.getVideoDuration(asset.path).catch(() => 0)
          : Promise.resolve(0),
      ])
      return {
        ...asset,
        width: resolution?.width ?? asset.width ?? 0,
        height: resolution?.height ?? asset.height ?? 0,
        duration: duration || asset.duration || 0,
      }
    }))
  }

  async function handleChooseAssets(assets: WorkspaceMediaAsset[]): Promise<void> {
    const request = pendingChooseAssetsRef.current
    if (!request) {
      throw new Error('素材选择请求已失效')
    }
    const enrichedAssets = await enrichWorkspaceAssets(assets)
    if (pendingChooseAssetsRef.current !== request) {
      throw new Error('素材选择请求已失效')
    }
    replyToChooseAssets(request, enrichedAssets)
  }

  function handleChooseAssetsOpenChange(open: boolean): void {
    if (!open) {
      const request = pendingChooseAssetsRef.current
      if (request) replyToChooseAssets(request, [])
    }
    setChooseAssetsOpen(open)
  }

  async function handleFrameLoad(): Promise<void> {
    setLoaded(true)
    if (editorView.mode !== 'media' || editorView.media.length === 0 || importStartedRef.current || !frameRef.current) return
    importStartedRef.current = true
    setImporting(true)
    try {
      await importMediaIntoFrame(frameRef.current, editorView.media)
    } catch (error) {
      console.error('[AI 剪辑] 导入素材失败', error)
      setImportFailed(true)
    } finally {
      setImporting(false)
    }
  }

  return (
    <div className="ai-editor-page">
      {(!loaded || importing || importFailed) && (
        <div className="ai-editor-loading" role="status">
          {importFailed ? '素材导入失败' : importing ? '正在导入素材' : '正在打开 AI 剪辑'}
        </div>
      )}
      <iframe
        ref={frameRef}
        key={`${editorView.mode}-${editorView.revision}`}
        className="ai-editor-frame"
        title="AI 剪辑"
        src={editorView.mode === 'media' ? './ai-editor/index.html#/new' : './ai-editor/index.html#/projects'}
        onLoad={() => void handleFrameLoad()}
      />
      <WorkspaceImportDialog
        open={chooseAssetsOpen}
        onOpenChange={handleChooseAssetsOpenChange}
        existingPaths={new Set(chooseAssetsExistingPaths)}
        purpose="ai-editor"
        onImport={handleChooseAssets}
      />
    </div>
  )
}
