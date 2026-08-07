import { memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  ChevronRight,
  Loader2,
  Play,
  RotateCcw,
  Send,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import { Textarea } from '@freecut/components/ui/textarea'
import { cn } from '@freecut/shared/ui/cn'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import { useAiEditingStore } from '../store'
import type { AiEditingPlanStep, AiEditingToolRisk } from '../types'
import { AiProviderDialog } from './ai-provider-dialog'

const SUGGESTIONS = [
  '帮我查看当前时间轴内容',
  '找出口播里提到产品价格的地方',
  '给已识别的口播生成字幕',
  '把选中的片段做得更紧凑一些',
]

function riskLabel(risk: Exclude<AiEditingToolRisk, 'read'>): string {
  if (risk === 'analysis') return '分析素材'
  if (risk === 'settings') return '调整设置'
  return '调整时间轴'
}

const PlanStep = memo(function PlanStep({ step }: { step: AiEditingPlanStep }) {
  return (
    <li className="flex items-start gap-2 py-1 text-xs text-foreground">
      <ChevronRight className="mt-0.5 h-3.5 w-3.5 shrink-0 text-primary" />
      <span className="min-w-0 flex-1">{step.summary}</span>
      <span className="shrink-0 text-[10px] text-muted-foreground">{riskLabel(step.risk)}</span>
    </li>
  )
})

const PlanCard = memo(function PlanCard() {
  const plan = useAiEditingStore((state) => state.plan)
  const phase = useAiEditingStore((state) => state.phase)
  const applyPlan = useAiEditingStore((state) => state.applyPlan)
  const dismissPlan = useAiEditingStore((state) => state.dismissPlan)

  if (!plan) return null
  const applying = phase === 'applying'

  return (
    <section className="rounded-lg border border-primary/30 bg-primary/5 p-2.5" aria-label="待确认剪辑计划">
      <div className="flex items-start gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <div className="min-w-0">
          <p className="text-xs font-medium text-foreground">{plan.title}</p>
          {plan.summary && <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">{plan.summary}</p>}
        </div>
      </div>
      <ol className="mt-2 divide-y divide-border/70">{plan.steps.map((step, index) => <PlanStep key={`${step.toolId}-${index}`} step={step} />)}</ol>
      <div className="mt-2.5 flex gap-1.5">
        <Button size="sm" className="h-7 flex-1 gap-1.5" onClick={() => void applyPlan()} disabled={applying}>
          {applying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
          应用计划
        </Button>
        <Button size="sm" variant="ghost" className="h-7 gap-1.5" onClick={dismissPlan} disabled={applying}>
          <X className="h-3.5 w-3.5" />
          放弃
        </Button>
      </div>
    </section>
  )
})

type ConnectionState = 'checking' | 'ready' | 'needs-setup' | 'unavailable'

interface AiEditingPanelProps {
  onClose?: () => void
}

export const AiEditingPanel = memo(function AiEditingPanel({ onClose }: AiEditingPanelProps) {
  const phase = useAiEditingStore((state) => state.phase)
  const loadPercent = useAiEditingStore((state) => state.loadPercent)
  const messages = useAiEditingStore((state) => state.messages)
  const observations = useAiEditingStore((state) => state.observations)
  const error = useAiEditingStore((state) => state.error)
  const streamingText = useAiEditingStore((state) => state.streamingText)
  const submit = useAiEditingStore((state) => state.submit)
  const cancel = useAiEditingStore((state) => state.cancel)
  const clear = useAiEditingStore((state) => state.clear)

  const [input, setInput] = useState('')
  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking')
  const scrollRef = useRef<HTMLDivElement>(null)
  const busy = phase !== 'idle' && phase !== 'awaiting-confirmation'
  const canChat = connectionState === 'ready'

  useEffect(() => {
    const bridge = getEmbeddedHostBridge().aiAssistant
    if (!bridge) {
      setConnectionState('unavailable')
      return
    }

    let active = true
    setConnectionState('checking')
    void bridge.getConfig().then((config) => {
      if (!active) return
      setConnectionState(config.hasApiKey && Boolean(config.baseUrl.trim()) && Boolean(config.model.trim())
        ? 'ready'
        : 'needs-setup')
    }).catch(() => {
      if (active) setConnectionState('unavailable')
    })
    return () => {
      active = false
    }
  }, [providerDialogOpen])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streamingText, phase])

  const send = useCallback((value: string) => {
    const text = value.trim()
    if (!text || busy || connectionState !== 'ready') return
    setInput('')
    void submit(text)
  }, [busy, connectionState, submit])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-foreground">剪辑助手</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setProviderDialogOpen(true)} aria-label="剪辑助手连接" data-tooltip="剪辑助手连接">
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button size="icon" variant="ghost" className="h-7 w-7" onClick={clear} aria-label="清空剪辑助手记录" data-tooltip="清空剪辑助手记录">
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          {onClose && (
            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={onClose} aria-label="关闭剪辑助手" data-tooltip="关闭剪辑助手">
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {connectionState === 'checking' && (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />正在检查连接
          </div>
        )}

        {connectionState === 'needs-setup' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
            <Settings2 className="h-5 w-5 text-primary" />
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">完成剪辑助手设置</p>
              <p className="text-xs leading-relaxed text-muted-foreground">设置服务地址、模型和 API Key 后即可开始对话。</p>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => setProviderDialogOpen(true)}>
              <Settings2 className="h-3.5 w-3.5" />
              去设置
            </Button>
          </div>
        )}

        {connectionState === 'unavailable' && (
          <div className="flex h-full items-center justify-center px-5 text-center text-xs leading-relaxed text-muted-foreground">
            当前无法使用剪辑助手连接。
          </div>
        )}

        {canChat && messages.length === 0 && phase === 'idle' && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">根据时间轴、字幕和本地素材分析提出可确认的剪辑计划。</p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <Button key={suggestion} size="sm" variant="outline" className="h-auto min-h-7 whitespace-normal px-2 py-1 text-left text-[11px]" onClick={() => send(suggestion)} disabled={!canChat}>
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}

        {canChat && messages.map((message) => (
          <div key={message.id} className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}>
            <div className={cn('max-w-[88%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-relaxed', message.role === 'user' ? 'bg-primary text-primary-foreground' : 'bg-secondary/60 text-foreground')}>
              {message.content}
            </div>
          </div>
        ))}

        {canChat && streamingText && (
          <div className="rounded-lg bg-secondary/60 px-2.5 py-1.5 text-xs leading-relaxed text-foreground">{streamingText}</div>
        )}

        {canChat && phase === 'loading' && (
          <div className="space-y-1.5 text-xs text-muted-foreground">
            <div className="flex items-center gap-2"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在准备剪辑助手</div>
            <div className="h-1 overflow-hidden rounded-full bg-secondary"><div className="h-full bg-primary transition-[width]" style={{ width: `${loadPercent}%` }} /></div>
          </div>
        )}
        {canChat && phase === 'thinking' && <div className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="h-3.5 w-3.5 animate-spin" />正在整理剪辑建议</div>}
        {canChat && observations.length > 0 && <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Check className="h-3.5 w-3.5 text-emerald-500" />已参考 {observations.length} 条素材或项目结果</div>}
        {canChat && <PlanCard />}
        {canChat && error && <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs leading-relaxed text-destructive">{error}</div>}
      </div>

      <div className="shrink-0 border-t border-border p-2.5">
        <div className="flex items-end gap-1.5">
          <Textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                send(input)
              }
            }}
            placeholder={canChat ? '描述想要完成的剪辑' : '完成设置后开始对话'}
            className="min-h-9 max-h-28 resize-none text-xs"
            disabled={!canChat || busy}
          />
          {busy ? (
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={cancel} aria-label="停止生成剪辑建议"><X className="h-4 w-4" /></Button>
          ) : (
            <Button size="icon" className="h-9 w-9 shrink-0" onClick={() => send(input)} disabled={!canChat || !input.trim()} aria-label="发送剪辑请求"><Send className="h-4 w-4" /></Button>
          )}
        </div>
      </div>
      <AiProviderDialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen} />
    </div>
  )
})
