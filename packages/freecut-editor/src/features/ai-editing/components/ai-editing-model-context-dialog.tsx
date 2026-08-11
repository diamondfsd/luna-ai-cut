import { useEffect, useMemo, useState } from 'react'
import { BrainCircuit, Check, Copy, Loader2 } from 'lucide-react'
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
  listAiEditingRuns,
  type AiEditingRunEvent,
  type AiEditingRunRecord,
} from '@freecut/infrastructure/storage'
import { cn } from '@freecut/shared/ui/cn'

interface AiEditingModelContextDialogProps {
  open: boolean
  projectId: string | null
  onOpenChange(open: boolean): void
}

interface ModelCall {
  key: string
  round: number
  at: number
  request: unknown
  response?: unknown
  usage?: ModelUsage
}

interface ModelUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
  cachedTokens: number
  cachePercent: number
}

function formatTimestamp(value: number): string {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function eventRound(event: AiEditingRunEvent): number | null {
  if (!event.data || typeof event.data !== 'object') return null
  const round = (event.data as { round?: unknown }).round
  return typeof round === 'number' ? round : null
}

function eventProtocol(event: AiEditingRunEvent): string | null {
  if (!event.data || typeof event.data !== 'object') return null
  const protocol = (event.data as { protocol?: unknown }).protocol
  return typeof protocol === 'string' ? protocol : null
}

function eventUsage(event: AiEditingRunEvent): ModelUsage | null {
  if (event.type !== 'model-usage' || !event.data || typeof event.data !== 'object') return null
  const data = event.data as Partial<ModelUsage>
  if (
    typeof data.promptTokens !== 'number' ||
    typeof data.completionTokens !== 'number' ||
    typeof data.totalTokens !== 'number' ||
    typeof data.cachedTokens !== 'number' ||
    typeof data.cachePercent !== 'number'
  ) return null
  return {
    promptTokens: data.promptTokens,
    completionTokens: data.completionTokens,
    totalTokens: data.totalTokens,
    cachedTokens: data.cachedTokens,
    cachePercent: data.cachePercent,
  }
}

function modelCalls(run: AiEditingRunRecord): ModelCall[] {
  const events = run.events ?? []
  return events.flatMap((event, index) => {
    if (event.type !== 'model-context') return []
    const round = eventRound(event) ?? index + 1
    const protocol = eventProtocol(event)
    const response = events.slice(index + 1).find(
      (candidate) =>
        candidate.type === 'model-response' && eventRound(candidate) === round,
    )
    const usageEvent = events.slice(index + 1).find(
      (candidate) => candidate.type === 'model-usage' &&
        eventRound(candidate) === round &&
        (protocol === null || eventProtocol(candidate) === protocol),
    )
    const usage = usageEvent ? eventUsage(usageEvent) : null
    return [{
      key: `${run.id}-${index}`,
      round,
      at: event.at,
      request: event.data,
      ...(response ? { response: response.data } : {}),
      ...(usage ? { usage } : {}),
    }]
  })
}

function displayCall(call: ModelCall): string {
  return `${JSON.stringify({
    usage: call.usage ?? null,
    request: call.request,
    response: call.response ?? null,
  }, null, 2)}\n`
}

function formatTokens(value: number): string {
  return new Intl.NumberFormat().format(value)
}

export function AiEditingModelContextDialog({
  open,
  projectId,
  onOpenChange,
}: AiEditingModelContextDialogProps) {
  const [runs, setRuns] = useState<AiEditingRunRecord[]>([])
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null)
  const [selectedCallKey, setSelectedCallKey] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const selectedRun = useMemo(
    () => runs.find((run) => run.id === selectedRunId) ?? null,
    [runs, selectedRunId],
  )
  const calls = useMemo(() => (selectedRun ? modelCalls(selectedRun) : []), [selectedRun])
  const selectedCall = calls.find((call) => call.key === selectedCallKey) ?? calls[0] ?? null

  useEffect(() => {
    if (!open || !projectId) return
    let active = true
    setLoading(true)
    setError(null)
    setCopied(false)
    void listAiEditingRuns(projectId)
      .then((next) => {
        if (!active) return
        setRuns(next)
        setSelectedRunId(next[0]?.id ?? null)
        setSelectedCallKey(null)
      })
      .catch(() => {
        if (!active) return
        setRuns([])
        setSelectedRunId(null)
        setSelectedCallKey(null)
        setError('无法读取模型上下文记录。')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [open, projectId])

  const copyCall = async (): Promise<void> => {
    if (!selectedCall) return
    try {
      await navigator.clipboard.writeText(displayCall(selectedCall))
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="freecut-app dark flex h-[82vh] w-[86vw] max-w-none flex-col gap-0 overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 py-5 pr-14">
          <DialogTitle>模型上下文</DialogTitle>
          <DialogDescription>查看每次模型调用实际使用的完整消息、工具和返回内容。</DialogDescription>
        </DialogHeader>
        <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)]">
          <aside className="min-h-0 border-r border-border bg-muted/20">
            <div className="border-b border-border px-4 py-3">
              <p className="text-xs font-medium text-foreground">执行记录</p>
            </div>
            <ScrollArea className="h-[calc(100%-2.75rem)]">
              {loading ? (
                <div className="flex min-h-24 items-center justify-center gap-2 px-4 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  正在读取记录
                </div>
              ) : runs.length > 0 ? (
                <div className="space-y-1 p-2">
                  {runs.map((run) => {
                    const callCount = modelCalls(run).length
                    return (
                      <Button
                        key={run.id}
                        type="button"
                        variant="ghost"
                        className={cn(
                          'h-auto min-h-16 w-full items-start justify-start whitespace-normal px-3 py-2 text-left hover:bg-background/80',
                          selectedRunId === run.id && 'bg-background text-foreground',
                        )}
                        onClick={() => {
                          setSelectedRunId(run.id)
                          setSelectedCallKey(null)
                          setCopied(false)
                        }}
                      >
                        <span className="min-w-0 space-y-1">
                          <span className="block truncate text-xs font-medium">{run.request}</span>
                          <span className="block text-[11px] text-muted-foreground">
                            {formatTimestamp(run.createdAt)} · {callCount} 次调用
                          </span>
                        </span>
                      </Button>
                    )
                  })}
                </div>
              ) : (
                <div className="flex min-h-24 flex-col items-center justify-center gap-2 px-5 text-center text-xs text-muted-foreground">
                  <BrainCircuit className="h-4 w-4" />
                  暂无模型调用记录
                </div>
              )}
            </ScrollArea>
          </aside>

          <section className="flex min-h-0 min-w-0 flex-col overflow-hidden">
            {selectedRun ? (
              <>
                <div className="shrink-0 border-b border-border px-5 py-3">
                  <p className="truncate text-sm font-medium text-foreground">{selectedRun.request}</p>
                  {calls.length > 0 ? (
                    <div className="mt-2 flex items-center justify-between gap-3">
                      <div className="flex min-w-0 flex-wrap gap-1.5">
                        {calls.map((call, index) => (
                          <Button
                            key={call.key}
                            type="button"
                            size="sm"
                            variant={selectedCall?.key === call.key ? 'secondary' : 'ghost'}
                            className="h-7 px-2 text-[11px]"
                            onClick={() => {
                              setSelectedCallKey(call.key)
                              setCopied(false)
                            }}
                          >
                            第 {index + 1} 次 · {formatTimestamp(call.at)}
                          </Button>
                        ))}
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 shrink-0 gap-1.5 px-2 text-[11px]"
                        onClick={() => void copyCall()}
                      >
                        {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                        {copied ? '已复制' : '复制完整记录'}
                      </Button>
                    </div>
                  ) : null}
                </div>
                {selectedCall ? (
                  <ScrollArea className="min-h-0 flex-1">
                    {selectedCall.usage ? (
                      <div className="grid grid-cols-5 gap-px border-b border-border bg-border">
                        {[
                          ['输入', formatTokens(selectedCall.usage.promptTokens)],
                          ['输出', formatTokens(selectedCall.usage.completionTokens)],
                          ['总计', formatTokens(selectedCall.usage.totalTokens)],
                          ['缓存', formatTokens(selectedCall.usage.cachedTokens)],
                          ['缓存占比', `${selectedCall.usage.cachePercent.toFixed(2)}%`],
                        ].map(([label, value]) => (
                          <div key={label} className="bg-background px-4 py-3">
                            <p className="text-[10px] text-muted-foreground">{label}</p>
                            <p className="mt-1 font-mono text-xs text-foreground">{value}</p>
                          </div>
                        ))}
                      </div>
                    ) : null}
                    <pre className="w-full min-w-0 whitespace-pre-wrap break-words p-5 font-mono text-[11px] leading-relaxed text-foreground">
                      {displayCall(selectedCall)}
                    </pre>
                  </ScrollArea>
                ) : (
                  <div className="flex flex-1 items-center justify-center px-8 text-center text-xs leading-relaxed text-muted-foreground">
                    这次运行没有保存模型上下文。新发起的请求会自动记录在这里。
                  </div>
                )}
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center px-8 text-center text-xs text-muted-foreground">
                {error ?? '选择一条执行记录查看模型上下文。'}
              </div>
            )}
          </section>
        </div>
      </DialogContent>
    </Dialog>
  )
}
