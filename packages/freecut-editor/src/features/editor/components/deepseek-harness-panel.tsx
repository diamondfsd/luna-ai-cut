import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { FolderOpen, Loader2, Settings2, X } from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import {
  getEmbeddedHostBridge,
} from '@freecut/shared/host/embedded-host'
import './deepseek-harness-panel.css'

export const DeepSeekHarnessPanel = memo(function DeepSeekHarnessPanel({
  projectId,
  onClose,
}: {
  projectId: string
  onClose?: () => void
}) {
  const hostBridge = getEmbeddedHostBridge()
  const bridge = hostBridge.deepseekHarness
  const sourceBridge = hostBridge.editingSourceGit
  const revealFile = hostBridge.revealFile
  const [webUrl, setWebUrl] = useState<string | null>(null)
  const [openSettingsWhenReady, setOpenSettingsWhenReady] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const iframeRef = useRef<HTMLIFrameElement>(null)

  useEffect(() => {
    if (!bridge) return undefined
    let active = true
    const removeStateListener = bridge.onWebState((state) => {
      if (!active || state.projectId !== projectId) return
      if (state.status === 'ready' && state.url) {
        setWebUrl(state.url)
        setError(null)
      } else if (state.status === 'error') {
        setWebUrl(null)
        setError(state.error ?? '无法打开 AI 助手。')
      }
    })
    return () => {
      active = false
      removeStateListener()
    }
  }, [bridge, projectId])

  useEffect(() => {
    if (!bridge) {
      setWebUrl(null)
      return undefined
    }
    let active = true
    setError(null)
    void bridge.getWebUrl(projectId).then((url) => {
      if (active) setWebUrl(url)
    }).catch((reason: unknown) => {
      if (active) {
        setWebUrl(null)
        setError(reason instanceof Error ? reason.message : '无法打开 AI 助手。')
      }
    })
    return () => {
      active = false
    }
  }, [bridge, projectId])

  const sendOpenSettings = useCallback((): boolean => {
    const frame = iframeRef.current
    if (!frame?.contentWindow || !webUrl) return false
    frame.contentWindow.postMessage(
      { type: 'luna-freecut:open-settings', section: 'models' },
      new URL(webUrl).origin,
    )
    return true
  }, [webUrl])

  const handleOpenSettings = useCallback(() => {
    if (sendOpenSettings()) return
    setOpenSettingsWhenReady(true)
  }, [sendOpenSettings])

  useEffect(() => {
    if (!openSettingsWhenReady || !webUrl) return undefined
    const timer = window.setTimeout(() => {
      if (sendOpenSettings()) setOpenSettingsWhenReady(false)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [openSettingsWhenReady, sendOpenSettings, webUrl])

  useEffect(() => {
    const onMessage = (event: MessageEvent): void => {
      if (event.source !== iframeRef.current?.contentWindow) return
      const data = event.data
      if (data === null || typeof data !== 'object' || Array.isArray(data)) return
      if ((data as { type?: unknown }).type !== 'luna-freecut:settings-ready') return
      if (openSettingsWhenReady && sendOpenSettings()) setOpenSettingsWhenReady(false)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [openSettingsWhenReady, sendOpenSettings])

  const handleOpenSourceDirectory = useCallback(async () => {
    if (!sourceBridge || !revealFile) return
    const sourceRoot = await sourceBridge.root(projectId)
    await revealFile(sourceRoot)
  }, [projectId, revealFile, sourceBridge])

  if (!bridge) {
    return <div className="deepseek-harness-panel flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">AI 助手不可用。</div>
  }

  return (
    <div className="deepseek-harness-panel flex h-full min-h-0 flex-col">
      <div className="deepseek-harness-panel__toolbar flex shrink-0 items-center justify-end gap-1 border-b border-border px-2 py-1.5">
        {sourceBridge && revealFile && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8"
            onClick={() => void handleOpenSourceDirectory()}
            aria-label="打开项目源码目录"
            data-tooltip="打开项目源码目录"
          >
            <FolderOpen className="h-4 w-4" />
          </Button>
        )}
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={handleOpenSettings} aria-label="打开 Harness 设置" data-tooltip="打开 Harness 设置">
          <Settings2 className="h-4 w-4" />
        </Button>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="关闭 AI 助手" data-tooltip="关闭 AI 助手">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {webUrl ? (
        <iframe
          ref={iframeRef}
          className="deepseek-harness-panel__webview min-h-0 flex-1"
          src={webUrl}
          title="DeepSeek Harness"
          allow="clipboard-read; clipboard-write"
        />
      ) : (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-2 p-6 text-center text-sm text-muted-foreground">
          {error ? <p className="deepseek-harness-config-error rounded-md px-3 py-2" role="alert">{error}</p> : <Loader2 className="h-5 w-5 animate-spin" aria-label="正在打开 AI 助手" />}
        </div>
      )}

    </div>
  )
})
