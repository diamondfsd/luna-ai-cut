import { memo } from 'react'
import { Check, Circle, CircleAlert, Loader2 } from 'lucide-react'
import type { AiEditingTaskActivity } from '../types'

export const AiEditingTaskList = memo(function AiEditingTaskList({
  activities,
}: {
  activities: AiEditingTaskActivity[]
}) {
  if (activities.length === 0) return null
  return (
    <section
      className="rounded-lg border border-border bg-secondary/20 p-2.5"
      aria-label="剪辑任务进度"
      aria-live="polite"
    >
      <p className="text-xs font-medium text-foreground">剪辑步骤</p>
      <ol className="mt-1.5 space-y-1">
        {activities.map((activity) => (
          <li key={activity.id} className="flex items-start gap-2 py-1 text-xs">
            {activity.status === 'running' ? (
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-primary" />
            ) : activity.status === 'succeeded' ? (
              <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-500" />
            ) : activity.status === 'failed' ? (
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            ) : (
              <Circle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground/50" />
            )}
            <div className="min-w-0 flex-1">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-foreground">{activity.title}</span>
                <span className="shrink-0 text-[10px] tabular-nums text-muted-foreground">
                  {activity.index + 1}/{activity.total}
                </span>
              </div>
              {activity.message && (
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                  {activity.message}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
})
