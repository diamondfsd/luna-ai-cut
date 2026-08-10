import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, Copy, History, Loader2, MessageSquareText, RotateCcw } from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@freecut/components/ui/dialog'
import { ScrollArea } from '@freecut/components/ui/scroll-area'
import {
  listAiEditingConversationHistory,
  type AiEditingConversationHistorySession,
} from '@freecut/infrastructure/storage'
import { cn } from '@freecut/shared/ui/cn'
import { describeAiEditingReference } from '../resource-references'
import type { AiEditingMessage } from '../store'
import { AiEditingMessageBubble } from './ai-editing-message'

interface AiEditingHistoryDialogProps {
  open: boolean
  projectId: string | null
  onOpenChange(open: boolean): void
  onResume(sessionId: string): Promise<boolean>
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function getSessionTitle(session: AiEditingConversationHistorySession): string {
  const firstUserMessage = session.messages.find((message) => message.role === 'user')
  const title = firstUserMessage?.content.replace(/\s+/g, ' ').trim()
  return title || '未命名会话'
}

function formatSessionForCopy(session: AiEditingConversationHistorySession): string {
  return session.messages
    .map((message) => {
      const references = message.references?.length
        ? `\n引用的编辑资源：\n${message.references.map((reference) => `- ${describeAiEditingReference(reference)}`).join('\n')}`
        : ''
      return `${message.role === 'user' ? '用户' : '助手'} · ${formatTimestamp(message.createdAt)}\n${message.content}${references}`
    })
    .join('\n\n')
}

export function AiEditingHistoryDialog({
  open,
  projectId,
  onOpenChange,
  onResume,
}: AiEditingHistoryDialogProps) {
  const [sessions, setSessions] = useState<AiEditingConversationHistorySession[]>([])
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [copiedSessionId, setCopiedSessionId] = useState<string | null>(null)
  const [resumingSessionId, setResumingSessionId] = useState<string | null>(null)

  const selectedSession = useMemo(
    () => sessions.find((session) => session.id === selectedSessionId) ?? null,
    [selectedSessionId, sessions],
  )

  useEffect(() => {
    if (!open || !projectId) return
    let active = true
    setLoading(true)
    setError(null)
    void listAiEditingConversationHistory(projectId)
      .then((next) => {
        if (!active) return
        setSessions(next)
        setSelectedSessionId(next[0]?.id ?? null)
      })
      .catch(() => {
        if (active) {
          setSessions([])
          setSelectedSessionId(null)
          setError('无法读取历史会话。')
        }
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, projectId])

  const copyMessage = useCallback(async (message: AiEditingMessage) => {
    try {
      const references = message.references?.length
        ? `\n\n引用的编辑资源：\n${message.references.map((reference) => `- ${describeAiEditingReference(reference)}`).join('\n')}`
        : ''
      await navigator.clipboard.writeText(`${message.content}${references}`)
      setCopiedMessageId(message.id)
    } catch {
      setCopiedMessageId(null)
    }
  }, [])

  const copySession = useCallback(async (session: AiEditingConversationHistorySession) => {
    try {
      await navigator.clipboard.writeText(formatSessionForCopy(session))
      setCopiedSessionId(session.id)
    } catch {
      setCopiedSessionId(null)
    }
  }, [])

  const resumeSession = useCallback(
    async (session: AiEditingConversationHistorySession) => {
      setResumingSessionId(session.id)
      setError(null)
      try {
        if (await onResume(session.id)) onOpenChange(false)
        else setError('无法恢复这段历史会话。')
      } finally {
        setResumingSessionId(null)
      }
    },
    [onOpenChange, onResume],
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="freecut-app dark flex h-[80vh] w-[80vw] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
          <DialogTitle>历史会话</DialogTitle>
          <DialogDescription>查看已归档的对话，也可以恢复一段会话继续交流。</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[18rem_minmax(0,1fr)]">
          <aside className="min-h-0 border-r border-border bg-muted/20">
            <div className="border-b border-border px-4 py-3">
              <p className="text-xs font-medium text-foreground">会话记录</p>
            </div>
            <ScrollArea className="h-[calc(100%-2.75rem)]">
              {loading ? (
                <div className="flex min-h-24 items-center justify-center gap-2 px-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在读取历史会话
                </div>
              ) : sessions.length > 0 ? (
                <div className="space-y-1 p-2">
                  {sessions.map((session) => (
                    <Button
                      key={session.id}
                      type="button"
                      variant="ghost"
                      className={cn(
                        'h-auto min-h-16 w-full items-start justify-start whitespace-normal px-3 py-2 text-left hover:bg-background/80',
                        selectedSessionId === session.id && 'bg-background text-foreground',
                      )}
                      onClick={() => {
                        setSelectedSessionId(session.id)
                        setCopiedMessageId(null)
                        setCopiedSessionId(null)
                      }}
                    >
                      <span className="min-w-0 space-y-1">
                        <span className="block truncate text-xs font-medium">
                          {getSessionTitle(session)}
                        </span>
                        <span className="block text-[11px] text-muted-foreground">
                          {formatTimestamp(session.archivedAt)} · {session.messages.length} 条消息
                        </span>
                      </span>
                    </Button>
                  ))}
                </div>
              ) : (
                <div className="flex min-h-24 flex-col items-center justify-center gap-2 px-5 text-center text-xs leading-relaxed text-muted-foreground">
                  <History className="h-4 w-4" />
                  暂无历史会话
                </div>
              )}
            </ScrollArea>
          </aside>

          <section className="min-h-0 min-w-0 overflow-hidden">
            {selectedSession ? (
              <div className="flex h-full min-h-0 flex-col">
                <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-4">
                  <div className="min-w-0 space-y-1">
                    <p className="truncate text-sm font-medium text-foreground">
                      {getSessionTitle(selectedSession)}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      开始于 {formatTimestamp(selectedSession.createdAt)} · 归档于{' '}
                      {formatTimestamp(selectedSession.archivedAt)}
                    </p>
                    {error && (
                      <p className="text-xs text-destructive" role="alert">
                        {error}
                      </p>
                    )}
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="gap-1.5"
                      onClick={() => void resumeSession(selectedSession)}
                      disabled={resumingSessionId !== null}
                    >
                      {resumingSessionId === selectedSession.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCcw className="h-3.5 w-3.5" />
                      )}
                      恢复并继续
                    </Button>
                    <Button
                      type="button"
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => void copySession(selectedSession)}
                      disabled={resumingSessionId !== null}
                      aria-label={
                        copiedSessionId === selectedSession.id ? '已复制会话' : '复制整段会话'
                      }
                      data-tooltip={
                        copiedSessionId === selectedSession.id ? '已复制会话' : '复制整段会话'
                      }
                    >
                      {copiedSessionId === selectedSession.id ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <Copy className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>
                <ScrollArea className="min-h-0 flex-1">
                  <div className="space-y-3 p-6">
                    {selectedSession.messages.map((message) => (
                      <AiEditingMessageBubble
                        key={message.id}
                        message={message}
                        copied={copiedMessageId === message.id}
                        onCopy={(entry) => void copyMessage(entry)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </div>
            ) : (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-muted-foreground">
                <MessageSquareText className="h-5 w-5" />
                {error ?? '选择一段历史会话查看内容。'}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
