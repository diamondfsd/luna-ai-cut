import { useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { AiEditorMediaSource } from '../shared/aiEditor'
import type { AiEditorAgentEvent, AiEditorMcpRequest, AiEditorMcpResponse, WorkspaceMediaAsset } from '../shared/types'
import { logger } from '../lib/rendererLogger'
import { toast } from '../ui'
import { WorkspaceImportDialog } from '../workspace/components/WorkspaceImportDialog'
import { buildAiEditorAgentPrompt } from './aiEditorAgentPrompt'
import './AiEditorPage.css'

interface AiEditorLocationState {
  media?: AiEditorMediaSource[]
  view?: 'projects'
  entryId?: number
}

interface AiEditorPageProps {
  active: boolean
}

interface AiEditorFrameAsset extends AiEditorMediaSource {
  id: string
}

interface ChooseAssetsRequest {
  source: 'luna-openreel'
  type: 'choose-assets'
  requestId: string
  projectId: string
  existingPaths: string[]
}

interface PendingMcpRequest {
  resolve: (response: AiEditorMcpResponse) => void
  timer: number
}

interface McpFrameResponse {
  source: 'luna-openreel'
  type: 'mcp-response'
  callId: string
  response: AiEditorMcpResponse
}

interface CopyAgentPromptRequest {
  source: 'luna-openreel'
  type: 'copy-agent-prompt'
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

function isMcpFrameResponse(value: unknown): value is McpFrameResponse {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<McpFrameResponse>
  return message.source === 'luna-openreel'
    && message.type === 'mcp-response'
    && typeof message.callId === 'string'
    && Boolean(message.response && typeof message.response === 'object')
}

function isCopyAgentPromptRequest(value: unknown): value is CopyAgentPromptRequest {
  if (!value || typeof value !== 'object') return false
  const message = value as Partial<CopyAgentPromptRequest>
  return message.source === 'luna-openreel' && message.type === 'copy-agent-prompt'
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

async function sendInitialMediaSources(
  frame: HTMLIFrameElement,
  assets: AiEditorFrameAsset[],
): Promise<void> {
  const target = frame.contentWindow
  if (!target) throw new Error('OpenReel 素材页面不可用')

  await new Promise<void>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      window.removeEventListener('message', handleMessage)
      reject(new Error('OpenReel 素材路径交接超时'))
    }, 5_000)
    const handleMessage = (event: MessageEvent<unknown>) => {
      if (event.source !== target || !event.data || typeof event.data !== 'object') return
      const message = event.data as { source?: unknown; type?: unknown }
      if (message.source !== 'luna-openreel' || message.type !== 'initial-media-sources-ready') return
      window.clearTimeout(timeoutId)
      window.removeEventListener('message', handleMessage)
      resolve()
    }
    window.addEventListener('message', handleMessage)
    target.postMessage({
      source: 'luna-host',
      type: 'initial-media-sources',
      assets,
    }, '*')
  })
}

async function importMediaIntoFrame(frame: HTMLIFrameElement, sources: AiEditorFrameAsset[]): Promise<void> {
  const input = await waitForMediaInput(frame)
  const transfer = new DataTransfer()
  const importedSources: AiEditorFrameAsset[] = []
  for (const source of sources) {
    let blob: Blob | null = null
    if (!/^file:\/\//i.test(source.path)) {
      try {
        const bytes = await window.luna.aiEditor.readFileBytes(source.path)
        if (bytes.byteLength > 0) blob = new Blob([bytes], { type: fileTypeForName(source.name, source.kind) })
      } catch {
        // Browser file URLs remain a fallback for web development and legacy paths.
      }
    }
    if (!blob) {
      const response = await fetch(fileUrlForPath(source.path))
      if (!response.ok) throw new Error(`无法读取 ${source.name}`)
      blob = await response.blob()
    }
    importedSources.push({ ...source, size: blob.size })
    logger.info('[AI 剪辑] 初始素材读取完成', { name: source.name, bytes: blob.size })
    transfer.items.add(new File([blob], source.name, {
      type: blob.type || fileTypeForName(source.name, source.kind),
      lastModified: Date.now(),
    }))
  }
  await sendInitialMediaSources(frame, importedSources)
  input.files = transfer.files
  input.dispatchEvent(new Event('change', { bubbles: true }))
}

export function AiEditorPage({ active }: AiEditorPageProps) {
  const location = useLocation()
  const locationState = location.state
  const frameRef = useRef<HTMLIFrameElement>(null)
  const importStartedRef = useRef(false)
  const initializedRef = useRef(false)
  const handledLocationKeyRef = useRef<string | null>(null)
  const initializationTokenRef = useRef(0)
  const pendingAgentActivationRef = useRef(false)
  const pendingChooseAssetsRef = useRef<ChooseAssetsRequest | null>(null)
  const pendingChooseAssetsTargetRef = useRef<WindowProxy | null>(null)
  const pendingMcpRequestsRef = useRef(new Map<string, PendingMcpRequest>())
  const [editorView, setEditorView] = useState<{ mode: 'projects' | 'media'; media: AiEditorFrameAsset[]; projectId: string | null; revision: number }>({
    mode: 'projects',
    media: [],
    projectId: null,
    revision: 0,
  })
  const [loaded, setLoaded] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importFailed, setImportFailed] = useState(false)
  const [chooseAssetsOpen, setChooseAssetsOpen] = useState(false)
  const [chooseAssetsExistingPaths, setChooseAssetsExistingPaths] = useState<string[]>([])

  useEffect(() => {
    const pendingMcpRequests = pendingMcpRequestsRef.current
    const offRequest = window.luna.aiEditor.mcp.onRequest(async (request: AiEditorMcpRequest) => {
      const target = frameRef.current?.contentWindow
      if (!target) return { ok: false, error: 'AI 剪辑页面尚未加载' }

      return await new Promise<AiEditorMcpResponse>((resolve) => {
        const timer = window.setTimeout(() => {
          pendingMcpRequests.delete(request.callId)
          resolve({ ok: false, error: 'AI 剪辑响应超时' })
        }, 60_000)
        pendingMcpRequests.set(request.callId, { resolve, timer })
        target.postMessage({
          source: 'luna-host',
          type: 'mcp-request',
          ...request,
        }, '*')
      })
    })

    return () => {
      offRequest()
      for (const request of pendingMcpRequests.values()) {
        window.clearTimeout(request.timer)
        request.resolve({ ok: false, error: 'AI 剪辑页面已关闭' })
      }
      pendingMcpRequests.clear()
    }
  }, [])

  useEffect(() => {
    const postAgentEvent = (event: AiEditorAgentEvent): void => {
      frameRef.current?.contentWindow?.postMessage({
        source: 'luna-host',
        type: 'agent-event',
        event,
      }, '*')
    }
    const offEvent = window.luna.aiEditor.agent.onEvent(postAgentEvent)
    const offActivate = window.luna.aiEditor.agent.onActivate(() => {
      pendingAgentActivationRef.current = true
      frameRef.current?.contentWindow?.postMessage({
        source: 'luna-host',
        type: 'agent-activate',
      }, '*')
    })
    return () => {
      offEvent()
      offActivate()
    }
  }, [])

  useEffect(() => {
    if (!active || location.pathname !== '/ai-editor') return
    const mediaSources = mediaSourcesFromState(locationState)
    const hasExplicitRequest = mediaSources.length > 0 || isProjectListRequest(locationState)
    if (hasExplicitRequest && handledLocationKeyRef.current === location.key) return
    if (!hasExplicitRequest && initializedRef.current) return

    initializedRef.current = true
    handledLocationKeyRef.current = location.key
    const initialAssets: AiEditorFrameAsset[] = mediaSources.map((source, index) => ({
      id: `openreel-${Date.now()}-${index}`,
      name: source.name,
      path: source.path,
      kind: source.kind,
    }))
    const nextView = !isProjectListRequest(locationState) && mediaSources.length > 0
      ? { mode: 'media' as const, media: initialAssets, projectId: null as string | null }
      : { mode: 'projects' as const, media: [], projectId: null as string | null }
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

    const initializationToken = initializationTokenRef.current + 1
    initializationTokenRef.current = initializationToken
    if (nextView.mode !== 'media') return

    void window.luna.aiEditor.project.create('AI 剪辑项目', nextView.media)
      .then((project) => {
        if (initializationTokenRef.current !== initializationToken) return
        setEditorView((previous) => ({ ...previous, projectId: project.projectId }))
      })
      .catch((error: unknown) => {
        if (initializationTokenRef.current !== initializationToken) return
        logger.error('[AI 剪辑] 创建本地项目失败', {
          error: error instanceof Error ? error.message : String(error),
        })
        setImportFailed(true)
      })
  }, [active, location.key, location.pathname, locationState])

  useEffect(() => {
    function handleMessage(event: MessageEvent<unknown>): void {
      if (event.source === frameRef.current?.contentWindow && isMcpFrameResponse(event.data)) {
        const pending = pendingMcpRequestsRef.current.get(event.data.callId)
        if (pending) {
          pendingMcpRequestsRef.current.delete(event.data.callId)
          window.clearTimeout(pending.timer)
          pending.resolve(event.data.response)
        }
        return
      }

      if (event.source !== frameRef.current?.contentWindow) return
      if (isCopyAgentPromptRequest(event.data)) {
        void copyAgentPrompt()
        return
      }

      const request = isChooseAssetsRequest(event.data) ? event.data : null
      if (!request) return

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
      const [resolution, duration, thumbnailUrl] = await Promise.all([
        window.luna.workspace.getMediaResolution(asset.path).catch(() => null),
        asset.kind === 'video'
          ? window.luna.workspace.getVideoDuration(asset.path).catch(() => 0)
          : Promise.resolve(0),
        asset.kind === 'video'
          ? window.luna.resolveThumbnail(asset.path, asset.kind).catch(() => null)
          : asset.thumbnailUrl
            ? Promise.resolve(asset.thumbnailUrl)
            : window.luna.resolveThumbnail(asset.path, asset.kind).catch(() => null),
      ])
      return {
        ...asset,
        thumbnailUrl,
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
    logger.info('[AI 剪辑] OpenReel iframe 已加载', {
      mode: editorView.mode,
      mediaCount: editorView.media.length,
    })
    try {
      const snapshot = await window.luna.aiEditor.agent.getSnapshot()
      frameRef.current?.contentWindow?.postMessage({
        source: 'luna-host',
        type: 'agent-state',
        snapshot,
      }, '*')
      if (pendingAgentActivationRef.current) {
        pendingAgentActivationRef.current = false
        frameRef.current?.contentWindow?.postMessage({
          source: 'luna-host',
          type: 'agent-activate',
        }, '*')
      }
    } catch (error) {
      logger.warn('[AI 剪辑] 外部 Agent 状态同步失败', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    if (editorView.mode !== 'media' || !editorView.projectId || editorView.media.length === 0 || importStartedRef.current || !frameRef.current) return
    importStartedRef.current = true
    setImporting(true)
    try {
      await importMediaIntoFrame(frameRef.current, editorView.media)
      logger.info('[AI 剪辑] 初始素材已交给 OpenReel', { mediaCount: editorView.media.length })
    } catch (error) {
      logger.error('[AI 剪辑] 导入素材失败', {
        mediaCount: editorView.media.length,
        error: error instanceof Error ? error.message : String(error),
      })
      setImportFailed(true)
    } finally {
      setImporting(false)
    }
  }

  async function copyAgentPrompt(): Promise<void> {
    try {
      const launcherPath = await window.luna.aiEditor.mcp.getLauncherPath()
      await navigator.clipboard.writeText(buildAiEditorAgentPrompt(launcherPath))
      toast.success('已复制提示词，请粘贴到对应的任意 AI Agent 里面去')
    } catch (error) {
      logger.error('[AI 剪辑] 复制 Agent 提示词失败', {
        error: error instanceof Error ? error.message : String(error),
      })
      toast.error('复制失败，请重试')
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
        key={`${editorView.mode}-${editorView.projectId ?? 'pending'}-${editorView.revision}`}
        className="ai-editor-frame"
        title="AI 剪辑"
        src={editorView.mode === 'media'
          ? editorView.projectId
            ? `./ai-editor/index.html#/luna-editor?projectId=${encodeURIComponent(editorView.projectId)}`
            : './ai-editor/index.html#/new'
          : './ai-editor/index.html#/projects'}
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
