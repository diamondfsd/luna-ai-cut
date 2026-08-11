import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
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
import { ScrollArea } from '@freecut/components/ui/scroll-area'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@freecut/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@freecut/components/ui/tabs'
import { useSettingsStore, type VisualAnalysisIntensity } from '@freecut/features/editor/deps/settings'
import { getEmbeddedHostBridge, type EmbeddedAiAssistantConfig } from '@freecut/shared/host/embedded-host'

interface AiProviderDialogProps {
  open: boolean
  onOpenChange(open: boolean): void
}

const EMPTY_CONFIG: EmbeddedAiAssistantConfig = {
  baseUrl: 'https://api.openai.com/v1',
  model: '',
  contextWindowTokens: 256 * 1024,
  hasApiKey: false,
}

type AiAssistantSettingsSection = 'connection' | 'analysis'

export function AiProviderDialog({ open, onOpenChange }: AiProviderDialogProps) {
  const [config, setConfig] = useState<EmbeddedAiAssistantConfig>(EMPTY_CONFIG)
  const [section, setSection] = useState<AiAssistantSettingsSection>('connection')
  const [baseUrl, setBaseUrl] = useState(EMPTY_CONFIG.baseUrl)
  const [model, setModel] = useState('')
  const [contextWindowK, setContextWindowK] = useState('256')
  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const visualAnalysisIntensity = useSettingsStore((state) => state.visualAnalysisIntensity)
  const setSetting = useSettingsStore((state) => state.setSetting)

  useEffect(() => {
    if (!open) return
    setSection('connection')
    const bridge = getEmbeddedHostBridge().aiAssistant
    if (!bridge) {
      setError('当前环境不支持剪辑助手模型连接。')
      return
    }
    let active = true
    setLoading(true)
    setError(null)
    void bridge.getConfig().then((next) => {
      if (!active) return
      setConfig(next)
      setBaseUrl(next.baseUrl)
      setModel(next.model)
      setContextWindowK(String(next.contextWindowTokens / 1024))
      setApiKey('')
    }).catch((reason: unknown) => {
      if (active) setError(reason instanceof Error ? reason.message : '无法读取剪辑助手连接。')
    }).finally(() => {
      if (active) setLoading(false)
    })
    return () => {
      active = false
    }
  }, [open])

  const save = async (): Promise<void> => {
    const bridge = getEmbeddedHostBridge().aiAssistant
    if (!bridge) {
      setError('当前环境不支持剪辑助手模型连接。')
      return
    }
    setSaving(true)
    setError(null)
    try {
      const next = await bridge.saveConfig({
        baseUrl,
        model,
        contextWindowTokens: Math.round(Number(contextWindowK) * 1024),
        ...(apiKey.trim() ? { apiKey } : {}),
      })
      setConfig(next)
      setApiKey('')
      onOpenChange(false)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法保存剪辑助手连接。')
    } finally {
      setSaving(false)
    }
  }

  const clearApiKey = async (): Promise<void> => {
    const bridge = getEmbeddedHostBridge().aiAssistant
    if (!bridge) return
    setSaving(true)
    setError(null)
    try {
      const next = await bridge.saveConfig({
        baseUrl,
        model,
        contextWindowTokens: Math.round(Number(contextWindowK) * 1024),
        clearApiKey: true,
      })
      setConfig(next)
      setApiKey('')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '无法清除 API Key。')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="freecut-app dark flex h-[80vh] w-[80vw] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
          <DialogTitle>剪辑助手设置</DialogTitle>
          <DialogDescription>管理剪辑助手的模型连接和素材识别方式。</DialogDescription>
        </DialogHeader>
        <Tabs
          value={section}
          onValueChange={(value) => setSection(value as AiAssistantSettingsSection)}
          className="grid min-h-0 flex-1 grid-cols-[13rem_minmax(0,1fr)]"
        >
          <aside className="min-h-0 border-r border-border bg-muted/20 px-3 py-4">
            <TabsList
              aria-label="剪辑助手设置菜单"
              className="flex h-auto w-full flex-col items-stretch justify-start gap-1 rounded-none bg-transparent p-0"
            >
              <TabsTrigger value="connection" className="w-full justify-start px-3 py-2 text-left">
                模型连接
              </TabsTrigger>
              <TabsTrigger value="analysis" className="w-full justify-start px-3 py-2 text-left">
                素材识别
              </TabsTrigger>
            </TabsList>
          </aside>

          <div className="min-h-0 min-w-0 overflow-hidden">
            <TabsContent value="connection" className="m-0 h-full min-h-0">
              <ScrollArea className="h-full">
                <form className="mx-auto flex min-h-full w-full max-w-2xl flex-col gap-6 p-8" onSubmit={(event) => {
                  event.preventDefault()
                  void save()
                }}>
                  <div className="space-y-1.5">
                    <h2 className="text-base font-semibold text-foreground">模型连接</h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      填写模型服务连接信息。
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-assistant-base-url">服务地址</Label>
                    <Input
                      id="ai-assistant-base-url"
                      value={baseUrl}
                      onChange={(event) => setBaseUrl(event.target.value)}
                      placeholder="https://api.openai.com/v1"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={loading || saving}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-assistant-model">模型</Label>
                    <Input
                      id="ai-assistant-model"
                      value={model}
                      onChange={(event) => setModel(event.target.value)}
                      placeholder="例如 gpt-5-mini"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={loading || saving}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-assistant-context-window">模型记忆长度（K）</Label>
                    <Input
                      id="ai-assistant-context-window"
                      type="number"
                      min={16}
                      max={2048}
                      step={1}
                      value={contextWindowK}
                      onChange={(event) => setContextWindowK(event.target.value)}
                      disabled={loading || saving}
                    />
                    <p className="text-xs leading-relaxed text-muted-foreground">
                      默认 256K，使用量接近 80% 时才会整理较早内容。
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-3">
                      <Label htmlFor="ai-assistant-api-key">API Key</Label>
                      <span className="text-xs text-muted-foreground">{config.hasApiKey ? '已保存' : '未保存'}</span>
                    </div>
                    <Input
                      id="ai-assistant-api-key"
                      type="password"
                      value={apiKey}
                      onChange={(event) => setApiKey(event.target.value)}
                      placeholder={config.hasApiKey ? '输入新 Key 以替换' : '输入 API Key'}
                      autoComplete="new-password"
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      disabled={loading || saving}
                    />
                  </div>
                  {error && <p className="text-sm leading-relaxed text-destructive">{error}</p>}
                  <DialogFooter className="mt-auto border-t border-border pt-5 sm:space-x-0">
                    {config.hasApiKey && (
                      <Button type="button" variant="outline" onClick={() => void clearApiKey()} disabled={loading || saving}>
                        清除 Key
                      </Button>
                    )}
                    <Button type="submit" disabled={loading || saving}>
                      {(loading || saving) && <Loader2 className="h-4 w-4 animate-spin" />}
                      保存
                    </Button>
                  </DialogFooter>
                </form>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="analysis" className="m-0 h-full min-h-0">
              <ScrollArea className="h-full">
                <div className="mx-auto w-full max-w-2xl space-y-6 p-8">
                  <div className="space-y-1.5">
                    <h2 className="text-base font-semibold text-foreground">素材识别</h2>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      调整剪辑助手分析视频素材画面的方式。
                    </p>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="ai-assistant-visual-analysis-intensity">视频素材识别强度</Label>
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      控制画面抽取频率和识别范围。更强会检查更多画面并识别更多内容，但耗时更长。
                    </p>
                  </div>
                  <Select
                    value={visualAnalysisIntensity}
                    onValueChange={(value) =>
                      setSetting('visualAnalysisIntensity', value as VisualAnalysisIntensity)
                    }
                  >
                    <SelectTrigger id="ai-assistant-visual-analysis-intensity" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">轻</SelectItem>
                      <SelectItem value="normal">一般</SelectItem>
                      <SelectItem value="strong">强</SelectItem>
                    </SelectContent>
                  </Select>
                  <p className="text-xs leading-relaxed text-muted-foreground">
                    轻适合快速查看，一般平衡速度与覆盖，强适合需要更完整画面信息的素材。
                  </p>
                </div>
              </ScrollArea>
            </TabsContent>
          </div>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
