import { Fragment, memo, useCallback, useEffect, useRef, useState } from 'react'
import {
  Check,
  CircleAlert,
  Copy,
  Loader2,
  RotateCcw,
  Settings2,
  LibraryBig,
  Sparkles,
  X,
} from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import { getEmbeddedHostBridge } from '@freecut/shared/host/embedded-host'
import { describeAiEditingReference } from '../resource-references'
import { useAiEditingStore, type AiEditingMessage } from '../store'
import type { AiEditingToolActivity } from '../types'
import {
  formatAiEditingRecordPaths,
  resolveAiEditingRecordPaths,
} from '../conversation-record-paths'
import { AiEditingComposer } from './ai-editing-composer'
import { AiEditingMessageBubble } from './ai-editing-message'
import { AiProviderDialog } from './ai-provider-dialog'
import { AiEditingSkillsDialog } from './ai-editing-skills-dialog'

const SUGGESTIONS = [
  '帮我查看当前时间轴内容',
  '找出口播里提到产品价格的地方',
  '给已识别的口播生成字幕',
  '把选中的片段做得更紧凑一些',
]

const ToolActivityRow = memo(function ToolActivityRow({
  activity,
}: {
  activity: AiEditingToolActivity
}) {
  const status =
    activity.status === 'running' ? (
      <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
    ) : activity.status === 'succeeded' ? (
      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
    ) : (
      <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
    )
  return (
    <li className="flex items-start gap-2 py-1.5 text-xs">
      {status}
      <div className="min-w-0 flex-1">
        <p className="text-foreground">{activity.title}</p>
        {activity.progressPercent !== undefined && (
          <div className="mt-1.5 space-y-1">
            <div className="flex items-center justify-between gap-2 text-[10px] text-muted-foreground">
              <span className="min-w-0 truncate">{activity.progressLabel ?? '正在处理'}</span>
              {activity.progressPercent !== null && (
                <span className="shrink-0 tabular-nums">{activity.progressPercent}%</span>
              )}
            </div>
            <div
              className="h-1 overflow-hidden rounded-full bg-secondary"
              role="progressbar"
              aria-label={activity.progressLabel ?? activity.title}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={activity.progressPercent ?? undefined}
            >
              <div
                className={
                  activity.progressPercent === null
                    ? 'h-full w-full animate-pulse bg-primary/55'
                    : 'h-full bg-primary transition-[width] duration-200'
                }
                style={
                  activity.progressPercent === null
                    ? undefined
                    : { width: `${activity.progressPercent}%` }
                }
              />
            </div>
          </div>
        )}
        {activity.message && (
          <p className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
            {activity.message}
          </p>
        )}
      </div>
    </li>
  )
})

const ToolActivityCard = memo(function ToolActivityCard({
  activities,
}: {
  activities: AiEditingToolActivity[]
}) {
  if (activities.length === 0) return null
  return (
    <section
      className="rounded-lg border border-primary/25 bg-primary/5 p-2.5"
      aria-label="剪辑执行过程"
      aria-live="polite"
    >
      <div className="flex items-center gap-2">
        <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
        <p className="text-xs font-medium text-foreground">本次剪辑操作</p>
      </div>
      <ol className="mt-1.5 divide-y divide-border/70">
        {activities.map((activity) => (
          <ToolActivityRow key={activity.id} activity={activity} />
        ))}
      </ol>
    </section>
  )
})

const PhaseProgressCard = memo(function PhaseProgressCard({
  label,
  percent,
  ceiling,
}: {
  label: string
  percent: number | null
  ceiling?: number
}) {
  const [displayPercent, setDisplayPercent] = useState(percent)

  useEffect(() => {
    setDisplayPercent(percent)
  }, [percent])

  useEffect(() => {
    if (percent === null || ceiling === undefined || ceiling <= percent) return
    const timer = window.setInterval(() => {
      setDisplayPercent((current) => {
        if (current === null || current >= ceiling) return current
        return Math.min(ceiling, current + 1)
      })
    }, 1_200)
    return () => window.clearInterval(timer)
  }, [ceiling, percent])

  return (
    <section className="rounded-lg border border-border bg-secondary/30 p-2.5" aria-live="polite">
      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{label}</span>
        {displayPercent !== null && (
          <span className="tabular-nums">{Math.round(displayPercent)}%</span>
        )}
      </div>
      <div
        className="mt-1.5 h-1 overflow-hidden rounded-full bg-secondary"
        role="progressbar"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={displayPercent ?? undefined}
      >
        <div
          className={
            percent === null
              ? 'h-full w-full animate-pulse bg-primary/55'
              : 'h-full bg-primary transition-[width] duration-200'
          }
          style={displayPercent === null ? undefined : { width: `${displayPercent}%` }}
        />
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
  const thinkingLabel = useAiEditingStore((state) => state.thinkingLabel)
  const thinkingPercent = useAiEditingStore((state) => state.thinkingPercent)
  const thinkingCeiling = useAiEditingStore((state) => state.thinkingCeiling)
  const messages = useAiEditingStore((state) => state.messages)
  const toolActivities = useAiEditingStore((state) => state.toolActivities)
  const reasoningEffort = useAiEditingStore((state) => state.reasoningEffort)
  const setReasoningEffort = useAiEditingStore((state) => state.setReasoningEffort)
  const error = useAiEditingStore((state) => state.error)
  const isRestoringConversation = useAiEditingStore((state) => state.isRestoringConversation)
  const projectId = useAiEditingStore((state) => state.projectId)
  const submit = useAiEditingStore((state) => state.submit)
  const cancel = useAiEditingStore((state) => state.cancel)
  const clear = useAiEditingStore((state) => state.clear)

  const [providerDialogOpen, setProviderDialogOpen] = useState(false)
  const [skillsDialogOpen, setSkillsDialogOpen] = useState(false)
  const [connectionState, setConnectionState] = useState<ConnectionState>('checking')
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [copiedRecordPaths, setCopiedRecordPaths] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const copyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const recordPathCopyResetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const busy = phase !== 'idle'
  const canChat = connectionState === 'ready' && !isRestoringConversation
  const activeUserMessageId = [...messages].reverse().find((message) => message.role === 'user')?.id

  useEffect(() => {
    const bridge = getEmbeddedHostBridge().aiAssistant
    if (!bridge) {
      setConnectionState('unavailable')
      return
    }

    let active = true
    setConnectionState('checking')
    void bridge
      .getConfig()
      .then((config) => {
        if (!active) return
        setConnectionState(
          config.hasApiKey && Boolean(config.baseUrl.trim()) && Boolean(config.model.trim())
            ? 'ready'
            : 'needs-setup',
        )
      })
      .catch(() => {
        if (active) setConnectionState('unavailable')
      })
    return () => {
      active = false
    }
  }, [providerDialogOpen])

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, toolActivities, phase])

  useEffect(
    () => () => {
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
      if (recordPathCopyResetTimer.current) clearTimeout(recordPathCopyResetTimer.current)
    },
    [],
  )

  const send = useCallback(
    (value: string, references?: AiEditingMessage['references']) => {
      if (busy || connectionState !== 'ready') return
      void submit(value, references)
    },
    [busy, connectionState, submit],
  )

  const copyMessage = useCallback(async (message: AiEditingMessage) => {
    try {
      const referenceText = message.references?.length
        ? `\n\n引用的编辑资源：\n${message.references.map((reference) => `- ${describeAiEditingReference(reference)}`).join('\n')}`
        : ''
      await navigator.clipboard.writeText(`${message.content}${referenceText}`)
      setCopiedMessageId(message.id)
      if (copyResetTimer.current) clearTimeout(copyResetTimer.current)
      copyResetTimer.current = setTimeout(() => setCopiedMessageId(null), 2_000)
    } catch {
      setCopiedMessageId(null)
    }
  }, [])

  const copyRecordPaths = useCallback(async () => {
    if (!projectId) return
    try {
      const paths = await resolveAiEditingRecordPaths(projectId)
      await navigator.clipboard.writeText(formatAiEditingRecordPaths(paths))
      setCopiedRecordPaths(true)
      if (recordPathCopyResetTimer.current) clearTimeout(recordPathCopyResetTimer.current)
      recordPathCopyResetTimer.current = setTimeout(() => setCopiedRecordPaths(false), 2_000)
    } catch {
      setCopiedRecordPaths(false)
    }
  }, [projectId])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-border px-3">
        <div className="flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-primary" />
          <span className="text-xs font-medium text-foreground">剪辑助手</span>
        </div>
        <div className="flex items-center gap-0.5">
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => void copyRecordPaths()}
            disabled={!projectId}
            aria-label={copiedRecordPaths ? '已复制助手记录路径' : '复制助手记录路径'}
            data-tooltip={copiedRecordPaths ? '已复制助手记录路径' : '复制助手记录路径'}
          >
            {copiedRecordPaths ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Copy className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setSkillsDialogOpen(true)}
            aria-label="管理剪辑技能"
            data-tooltip="管理剪辑技能"
          >
            <LibraryBig className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => setProviderDialogOpen(true)}
            aria-label="剪辑助手连接"
            data-tooltip="剪辑助手连接"
          >
            <Settings2 className="h-3.5 w-3.5" />
          </Button>
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7"
            onClick={() => void clear()}
            aria-label="清空剪辑助手记录"
            data-tooltip="清空剪辑助手记录"
          >
            <RotateCcw className="h-3.5 w-3.5" />
          </Button>
          {onClose && (
            <Button
              size="icon"
              variant="ghost"
              className="h-7 w-7"
              onClick={onClose}
              aria-label="关闭剪辑助手"
              data-tooltip="关闭剪辑助手"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-3">
        {isRestoringConversation && (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在恢复本项目的对话记录
          </div>
        )}

        {!isRestoringConversation && connectionState === 'checking' && (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            正在检查连接
          </div>
        )}

        {!isRestoringConversation && connectionState === 'needs-setup' && (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-5 text-center">
            <Settings2 className="h-5 w-5 text-primary" />
            <div className="space-y-1">
              <p className="text-xs font-medium text-foreground">完成剪辑助手设置</p>
              <p className="text-xs leading-relaxed text-muted-foreground">
                设置服务地址、模型和 API Key 后即可开始对话。
              </p>
            </div>
            <Button size="sm" className="gap-1.5" onClick={() => setProviderDialogOpen(true)}>
              <Settings2 className="h-3.5 w-3.5" />
              去设置
            </Button>
          </div>
        )}

        {!isRestoringConversation && connectionState === 'unavailable' && (
          <div className="flex h-full items-center justify-center px-5 text-center text-xs leading-relaxed text-muted-foreground">
            当前无法使用剪辑助手连接。
          </div>
        )}

        {canChat && messages.length === 0 && phase === 'idle' && (
          <div className="space-y-3">
            <p className="text-xs leading-relaxed text-muted-foreground">
              根据时间轴、字幕和本地素材分析，直接完成剪辑操作。
            </p>
            <div className="flex flex-wrap gap-1.5">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  size="sm"
                  variant="outline"
                  className="h-auto min-h-7 whitespace-normal px-2 py-1 text-left text-[11px]"
                  onClick={() => send(suggestion)}
                  disabled={!canChat}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}

        {canChat &&
          messages.map((message) => (
            <Fragment key={message.id}>
              <AiEditingMessageBubble
                message={message}
                copied={copiedMessageId === message.id}
                onCopy={(entry) => void copyMessage(entry)}
              />
              {message.id === activeUserMessageId && (
                <ToolActivityCard activities={toolActivities} />
              )}
            </Fragment>
          ))}

        {canChat && phase === 'loading' && (
          <PhaseProgressCard label="正在准备剪辑助手" percent={loadPercent} />
        )}
        {canChat && phase === 'thinking' && (
          <PhaseProgressCard
            label={thinkingLabel}
            percent={thinkingPercent}
            ceiling={thinkingCeiling}
          />
        )}
        {canChat &&
          phase === 'executing' &&
          !toolActivities.some((activity) => activity.status === 'running') && (
            <PhaseProgressCard label="正在检查结果并继续完成剪辑" percent={null} />
          )}
        {canChat && error && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-xs leading-relaxed text-destructive"
          >
            {error}
          </div>
        )}
      </div>

      <AiEditingComposer
        canChat={canChat}
        busy={busy}
        reasoningEffort={reasoningEffort}
        onReasoningEffortChange={setReasoningEffort}
        onSubmit={send}
        onCancel={cancel}
      />
      <AiProviderDialog open={providerDialogOpen} onOpenChange={setProviderDialogOpen} />
      <AiEditingSkillsDialog open={skillsDialogOpen} onOpenChange={setSkillsDialogOpen} />
    </div>
  )
})
