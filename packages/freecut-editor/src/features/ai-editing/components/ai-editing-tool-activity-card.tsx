import { memo, useState } from 'react'
import {
  Check,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Loader2,
  Sparkles,
} from 'lucide-react'
import { Button } from '@freecut/components/ui/button'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@freecut/components/ui/collapsible'
import type { AiEditingToolActivity } from '../types'

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
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[11px] leading-relaxed text-muted-foreground">
            {activity.message}
          </p>
        )}
      </div>
    </li>
  )
})

export const AiEditingToolActivityCard = memo(function AiEditingToolActivityCard({
  activities,
}: {
  activities: AiEditingToolActivity[]
}) {
  const [open, setOpen] = useState(false)
  const latestActivity = activities.at(-1)
  const previousActivities = activities.slice(0, -1)

  if (!latestActivity) return null

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section
        className="rounded-lg border border-primary/25 bg-primary/5 p-2.5"
        aria-label="剪辑执行过程"
        aria-live="polite"
      >
        <div className="flex min-h-7 items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <p className="truncate text-xs font-medium text-foreground">本次剪辑操作</p>
          </div>
          {previousActivities.length > 0 && (
            <CollapsibleTrigger asChild>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 shrink-0 gap-1 px-2 text-[11px] text-muted-foreground"
              >
                {open ? (
                  <>
                    <ChevronUp className="h-3.5 w-3.5" />
                    收起完整记录
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3.5 w-3.5" />
                    查看完整记录（{activities.length}）
                  </>
                )}
              </Button>
            </CollapsibleTrigger>
          )}
        </div>

        {previousActivities.length > 0 && (
          <CollapsibleContent>
            <ol className="mt-1.5 divide-y divide-border/70">
              {previousActivities.map((activity) => (
                <ToolActivityRow key={activity.id} activity={activity} />
              ))}
            </ol>
          </CollapsibleContent>
        )}
        <ol
          className={
            open && previousActivities.length > 0
              ? 'border-t border-border/70'
              : 'mt-1.5'
          }
        >
          <ToolActivityRow activity={latestActivity} />
        </ol>
      </section>
    </Collapsible>
  )
})
