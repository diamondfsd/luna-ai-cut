import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, Check, Loader2, Settings2, X } from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@freecut/components/ui/dialog'
import { Input } from '@freecut/components/ui/input'
import { Label } from '@freecut/components/ui/label'
import { cn } from '@freecut/shared/ui/cn'
import {
  getEmbeddedHostBridge,
  type EmbeddedDeepSeekHarnessConfig,
  type EmbeddedDeepSeekHarnessConfigInput,
} from '@freecut/shared/host/embedded-host'
import './deepseek-harness-panel.css'

const DEFAULT_CONTEXT_WINDOW_TOKENS = 262_144
const DEFAULT_MAX_OUTPUT_TOKENS = 131_072

interface SettingsForm {
  baseUrl: string
  model: string
  apiKey: string
  contextWindowTokens: string
  maxOutputTokens: string
}

function emptyForm(): SettingsForm {
  return {
    baseUrl: 'https://api.deepseek.com',
    model: '',
    apiKey: '',
    contextWindowTokens: String(DEFAULT_CONTEXT_WINDOW_TOKENS),
    maxOutputTokens: String(DEFAULT_MAX_OUTPUT_TOKENS),
  }
}

function formFromConfig(config: EmbeddedDeepSeekHarnessConfig): SettingsForm {
  return {
    baseUrl: config.baseUrl,
    model: config.model,
    apiKey: '',
    contextWindowTokens: String(config.contextWindowTokens || DEFAULT_CONTEXT_WINDOW_TOKENS),
    maxOutputTokens: String(config.maxOutputTokens || DEFAULT_MAX_OUTPUT_TOKENS),
  }
}

function buildConfigInput(form: SettingsForm): EmbeddedDeepSeekHarnessConfigInput {
  const contextWindowTokens = Number(form.contextWindowTokens)
  if (!Number.isSafeInteger(contextWindowTokens) || contextWindowTokens < 16_384) {
    throw new Error('模型记忆长度至少为 16K。')
  }
  const maxOutputTokens = Number(form.maxOutputTokens)
  if (!Number.isSafeInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > DEFAULT_MAX_OUTPUT_TOKENS) {
    throw new Error('单次输出长度应在 1 到 131072 之间。')
  }
  return {
    baseUrl: form.baseUrl,
    model: form.model,
    contextWindowTokens,
    maxOutputTokens,
    ...(form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
  }
}

const HarnessSettingsDialog = memo(function HarnessSettingsDialog({
  open,
  config,
  onOpenChange,
  onConfigChange,
}: {
  open: boolean
  config: EmbeddedDeepSeekHarnessConfig | null
  onOpenChange: (open: boolean) => void
  onConfigChange: (config: EmbeddedDeepSeekHarnessConfig) => void
}) {
  const { t } = useTranslation()
  const bridge = getEmbeddedHostBridge().deepseekHarness
  const [form, setForm] = useState<SettingsForm>(() => config ? formFromConfig(config) : emptyForm())
  const [busy, setBusy] = useState<'save' | 'test' | null>(null)
  const [message, setMessage] = useState<{ kind: 'error' | 'success'; text: string } | null>(null)

  useEffect(() => {
    if (open) {
      setForm(config ? formFromConfig(config) : emptyForm())
      setMessage(null)
    }
  }, [config, open])

  const updateField = useCallback(<K extends keyof SettingsForm>(key: K, value: SettingsForm[K]) => {
    setForm((current) => ({ ...current, [key]: value }))
    setMessage(null)
  }, [])

  const save = useCallback(async (test: boolean) => {
    if (!bridge) return
    setBusy(test ? 'test' : 'save')
    setMessage(null)
    try {
      const input = buildConfigInput(form)
      if (test) {
        const result = await bridge.testConfig(input)
        setForm((current) => ({ ...formFromConfig(result.config), apiKey: current.apiKey }))
        setMessage({ kind: result.connected ? 'success' : 'error', text: result.message })
      } else {
        const saved = await bridge.saveConfig(input)
        onConfigChange(saved)
        setForm(formFromConfig(saved))
        setMessage({ kind: 'success', text: '连接配置已保存。' })
      }
    } catch (error) {
      setMessage({ kind: 'error', text: error instanceof Error ? error.message : '保存连接配置失败，请重试。' })
    } finally {
      setBusy(null)
    }
  }, [bridge, form, onConfigChange])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('agent.settings.title', { defaultValue: 'AI 连接设置' })}</DialogTitle>
          <DialogDescription>这里只配置模型连接，DeepSeek Harness 负责完整的对话和编辑流程。</DialogDescription>
        </DialogHeader>
        <div className="deepseek-harness-config-form">
          <div className="deepseek-harness-config-field">
            <Label htmlFor="deepseek-harness-base-url">服务地址</Label>
            <Input id="deepseek-harness-base-url" value={form.baseUrl} onChange={(event) => updateField('baseUrl', event.target.value)} placeholder="https://api.deepseek.com" autoComplete="url" />
          </div>
          <div className="deepseek-harness-config-field">
            <Label htmlFor="deepseek-harness-api-key">API Key</Label>
            <Input id="deepseek-harness-api-key" type="password" value={form.apiKey} onChange={(event) => updateField('apiKey', event.target.value)} placeholder={config?.hasApiKey ? '已保存，留空则继续使用' : '请输入 API Key'} autoComplete="off" />
          </div>
          <div className="deepseek-harness-config-field">
            <Label htmlFor="deepseek-harness-model">模型名称</Label>
            <Input id="deepseek-harness-model" value={form.model} onChange={(event) => updateField('model', event.target.value)} placeholder="deepseek-chat" autoComplete="off" />
          </div>
          <div className="deepseek-harness-config-field">
            <Label htmlFor="deepseek-harness-context-window">记忆长度</Label>
            <Input id="deepseek-harness-context-window" type="number" min={16_384} max={2_097_152} step={16_384} value={form.contextWindowTokens} onChange={(event) => updateField('contextWindowTokens', event.target.value)} />
          </div>
          <div className="deepseek-harness-config-field">
            <Label htmlFor="deepseek-harness-max-output-tokens">单次输出长度</Label>
            <Input id="deepseek-harness-max-output-tokens" type="number" min={1} max={DEFAULT_MAX_OUTPUT_TOKENS} step={1} value={form.maxOutputTokens} onChange={(event) => updateField('maxOutputTokens', event.target.value)} />
            <p className="text-xs text-muted-foreground">范围为 1 到 131072，过大的值会被 DeepSeek 接口拒绝。</p>
          </div>
          {message && (
            <div className={cn('flex items-start gap-2 rounded-md px-3 py-2 text-xs', message.kind === 'error' ? 'deepseek-harness-config-error' : 'deepseek-harness-config-success')} role="status">
              {message.kind === 'error' ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> : <Check className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
              <span>{message.text}</span>
            </div>
          )}
        </div>
        <DialogFooter className="gap-2 sm:space-x-0">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={busy !== null}>关闭</Button>
          <Button variant="secondary" onClick={() => void save(false)} disabled={busy !== null}>{busy === 'save' && <Loader2 className="animate-spin" />}保存</Button>
          <Button variant="editorAction" onClick={() => void save(true)} disabled={busy !== null}>{busy === 'test' && <Loader2 className="animate-spin" />}测试连接</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
})

export const DeepSeekHarnessPanel = memo(function DeepSeekHarnessPanel({
  projectId,
  onClose,
}: {
  projectId: string
  onClose?: () => void
}) {
  const { t } = useTranslation()
  const bridge = getEmbeddedHostBridge().deepseekHarness
  const [config, setConfig] = useState<EmbeddedDeepSeekHarnessConfig | null>(null)
  const [webUrl, setWebUrl] = useState<string | null>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)

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
    void bridge.getConfig().then((nextConfig) => {
      if (active) setConfig(nextConfig)
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '无法读取 AI 连接设置。')
    })
    return () => {
      active = false
      removeStateListener()
    }
  }, [bridge, projectId])

  const configured = Boolean(config?.hasApiKey && config.model && config.baseUrl)

  useEffect(() => {
    if (!bridge || !configured) {
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
  }, [bridge, configured, projectId])

  const handleConfigChange = useCallback((nextConfig: EmbeddedDeepSeekHarnessConfig) => {
    setConfig(nextConfig)
    setWebUrl(null)
    setError(null)
  }, [])

  if (!bridge) {
    return <div className="deepseek-harness-panel flex h-full items-center justify-center p-6 text-center text-sm text-muted-foreground">AI 助手不可用。</div>
  }

  return (
    <div className="deepseek-harness-panel flex h-full min-h-0 flex-col">
      <div className="deepseek-harness-panel__toolbar flex shrink-0 items-center justify-end gap-1 border-b border-border px-2 py-1.5">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setSettingsOpen(true)} aria-label={t('agent.settings.open', { defaultValue: '打开 AI 连接设置' })} data-tooltip="AI 连接设置">
          <Settings2 className="h-4 w-4" />
        </Button>
        {onClose && (
          <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onClose} aria-label="关闭 AI 助手" data-tooltip="关闭 AI 助手">
            <X className="h-4 w-4" />
          </Button>
        )}
      </div>

      {!configured ? (
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
          <p className="text-sm text-muted-foreground">配置模型连接后开始使用 DeepSeek Harness。</p>
          <Button variant="secondary" size="sm" className="gap-1.5" onClick={() => setSettingsOpen(true)}><Settings2 className="h-3.5 w-3.5" />配置连接</Button>
        </div>
      ) : webUrl ? (
        <iframe
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

      <HarnessSettingsDialog open={settingsOpen} config={config} onOpenChange={setSettingsOpen} onConfigChange={handleConfigChange} />
    </div>
  )
})
