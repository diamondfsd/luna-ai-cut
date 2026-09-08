import { useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'

import type { AiEditorMediaSource } from '../shared/aiEditor'
import './AiEditorPage.css'

interface AiEditorLocationState {
  media?: AiEditorMediaSource[]
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

export function AiEditorPage() {
  const location = useLocation()
  const mediaSources = mediaSourcesFromState(location.state)
  const frameRef = useRef<HTMLIFrameElement>(null)
  const importStartedRef = useRef(false)
  const [loaded, setLoaded] = useState(false)
  const [importing, setImporting] = useState(false)
  const [importFailed, setImportFailed] = useState(false)

  async function handleFrameLoad(): Promise<void> {
    setLoaded(true)
    if (mediaSources.length === 0 || importStartedRef.current || !frameRef.current) return
    importStartedRef.current = true
    setImporting(true)
    try {
      await importMediaIntoFrame(frameRef.current, mediaSources)
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
        className="ai-editor-frame"
        title="AI 剪辑"
        src={mediaSources.length > 0 ? './ai-editor/index.html#/new' : './ai-editor/index.html'}
        onLoad={() => void handleFrameLoad()}
      />
    </div>
  )
}
