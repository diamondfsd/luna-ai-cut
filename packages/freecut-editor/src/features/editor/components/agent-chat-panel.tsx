import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Check,
  CircleDashed,
  Info,
  Loader2,
  Play,
  Send,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@freecut/components/ui/popover'
import { cn } from '@freecut/shared/ui/cn'
import { useAgentStore, type PlanStepState } from '../agent'

const SUGGESTIONS: { key: string; text: string }[] = [
  { key: 'silence', text: 'Remove the silences' },
  { key: 'fillers', text: 'Remove filler words' },
  { key: 'title', text: 'Add a title that says Hello' },
  { key: 'split', text: 'Split at the playhead' },
]

function StepIcon({ status }: { status: PlanStepState['status'] }) {
  switch (status) {
    case 'running':
      return <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
    case 'done':
      return <Check className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
    case 'error':
      return <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-destructive" />
    default:
      return <CircleDashed className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
  }
}

const PlanCard = memo(function PlanCard() {
  const { t } = useTranslation()
  const plan = useAgentStore((s) => s.plan)
  const phase = useAgentStore((s) => s.phase)
  const runPlan = useAgentStore((s) => s.runPlan)
  const dismissPlan = useAgentStore((s) => s.dismissPlan)

  if (!plan || plan.length === 0) return null

  const awaiting = phase === 'awaiting-confirm'
  const running = phase === 'running'
  const hasHandoff = plan.some((step) => step.handoff)

  return (
    <div className="rounded-lg border border-border bg-secondary/30 p-2.5">
      <div className="mb-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
        {t('agent.plan.title', { defaultValue: 'Plan' })}
      </div>
      <ol className="space-y-1.5">
        {plan.map((step, index) => (
          <li key={index} className="flex items-start gap-2 text-xs">
            <StepIcon status={step.status} />
            <div className="min-w-0">
              <span className="text-foreground">{step.summary}</span>
              {step.status === 'error' && step.result && (
                <span className="block text-[11px] text-destructive">{step.result}</span>
              )}
            </div>
          </li>
        ))}
      </ol>

      {hasHandoff && awaiting && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t('agent.plan.handoffNote', {
            defaultValue: 'Some steps open a review you confirm.',
          })}
        </p>
      )}

      {awaiting && (
        <div className="mt-2.5 flex items-center gap-1.5">
          <Button size="sm" className="h-7 flex-1 gap-1.5" onClick={() => void runPlan()}>
            <Play className="h-3.5 w-3.5" />
            {t('agent.plan.run', { defaultValue: 'Run' })}
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-7 gap-1.5 text-muted-foreground"
            onClick={dismissPlan}
          >
            <X className="h-3.5 w-3.5" />
            {t('agent.plan.discard', { defaultValue: 'Discard' })}
          </Button>
        </div>
      )}
      {running && (
        <p className="mt-2 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          {t('agent.plan.running', { defaultValue: 'Running…' })}
        </p>
      )}
    </div>
  )
})

export const AgentChatPanel = memo(function AgentChatPanel() {
  const { t } = useTranslation()
  const supported = useAgentStore((s) => s.supported)
  const messages = useAgentStore((s) => s.messages)
  const phase = useAgentStore((s) => s.phase)
  const modelStatus = useAgentStore((s) => s.modelStatus)
  const loadPercent = useAgentStore((s) => s.loadPercent)
  const loadError = useAgentStore((s) => s.loadError)
  const submit = useAgentStore((s) => s.submit)
  const cancel = useAgentStore((s) => s.cancel)
  const clearChat = useAgentStore((s) => s.clearChat)

  const [input, setInput] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const busy = phase !== 'idle'

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight })
  }, [messages, phase])

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      setInput('')
      void submit(trimmed)
    },
    [submit],
  )

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault()
        if (!busy) send(input)
      }
    },
    [busy, input, send],
  )

  if (!supported) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center">
        <Sparkles className="h-6 w-6 text-muted-foreground" />
        <p className="text-sm font-medium text-foreground">
          {t('agent.unsupported.title', { defaultValue: 'Assistant unavailable' })}
        </p>
        <p className="text-xs text-muted-foreground">
          {t('agent.unsupported.body', {
            defaultValue:
              'The on-device assistant needs WebGPU. Try a recent Chrome or Edge browser.',
          })}
        </p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Transcript */}
      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {messages.length === 0 && phase === 'idle' && (
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion.key}
                  type="button"
                  onClick={() => send(suggestion.text)}
                  className="rounded-full border border-border bg-secondary/30 px-2.5 py-1 text-[11px] text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
                >
                  {suggestion.text}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((message) => (
          <div
            key={message.id}
            className={cn('flex', message.role === 'user' ? 'justify-end' : 'justify-start')}
          >
            <div
              className={cn(
                'max-w-[85%] whitespace-pre-wrap rounded-lg px-2.5 py-1.5 text-xs leading-relaxed',
                message.role === 'user'
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-secondary/40 text-foreground',
              )}
            >
              {message.content}
            </div>
          </div>
        ))}

        {phase === 'planning' && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {modelStatus === 'loading'
              ? t('agent.status.loadingModel', {
                  defaultValue: 'Loading on-device model… {{percent}}%',
                  percent: loadPercent,
                })
              : t('agent.status.thinking', { defaultValue: 'Planning your edit…' })}
          </div>
        )}

        <PlanCard />

        {loadError && phase === 'idle' && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 p-2.5 text-[11px] text-destructive">
            {loadError}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 border-t border-border p-2.5">
        {modelStatus === 'loading' && (
          <div className="mb-2 h-1 overflow-hidden rounded-full bg-secondary">
            <div
              className="h-full rounded-full bg-primary transition-[width] duration-300"
              style={{ width: `${loadPercent}%` }}
            />
          </div>
        )}
        <div className="flex items-end gap-1.5">
          <Popover>
            <PopoverTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                className="h-9 w-9 shrink-0 text-muted-foreground"
                aria-label={t('agent.empty.infoLabel', { defaultValue: 'About this assistant' })}
              >
                <Info className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
            <PopoverContent align="start" side="top" className="w-64 p-3">
              <p className="text-xs leading-relaxed text-muted-foreground">
                {t('agent.empty.intro', {
                  defaultValue:
                    'Ask me to edit your timeline in plain language. I run fully on-device — nothing leaves your computer. I propose a plan first; you confirm before anything changes.',
                })}
              </p>
            </PopoverContent>
          </Popover>
          <textarea
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={t('agent.composer.placeholder', {
              defaultValue: 'Ask the assistant to edit…',
            })}
            className="max-h-28 min-h-[2.25rem] flex-1 resize-none rounded-md border border-border bg-secondary/30 px-2.5 py-1.5 text-xs text-foreground outline-none focus:border-primary/50"
          />
          {phase === 'planning' ? (
            <Button size="icon" variant="ghost" className="h-9 w-9 shrink-0" onClick={cancel}>
              <X className="h-4 w-4" />
            </Button>
          ) : (
            <Button
              size="icon"
              className="h-9 w-9 shrink-0"
              disabled={busy || !input.trim()}
              onClick={() => send(input)}
            >
              <Send className="h-4 w-4" />
            </Button>
          )}
        </div>
        {messages.length > 0 && (
          <div className="mt-1.5 flex justify-end">
            <Button
              variant="ghost"
              size="sm"
              className="h-6 gap-1 px-2 text-[11px] text-muted-foreground"
              onClick={clearChat}
              disabled={phase === 'running'}
            >
              <Trash2 className="h-3 w-3" />
              {t('agent.clear', { defaultValue: 'Clear' })}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
})
