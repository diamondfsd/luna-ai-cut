import path from 'node:path'
import type { AiEditorDirectorContext, DirectorLanPlanSummary } from '../../../src/shared/types'
import { directorPlanContentSignature } from '../../../src/lib/directorPlanSync.ts'

/** Use the plan reader's confined, verified local paths; never trust remote paths. */
export function directorMediaCandidates(plans: readonly DirectorLanPlanSummary[]) {
  return plans.flatMap(plan => plan.shots.flatMap(shot => shot.takes.flatMap(take => {
    if (plan.source !== 'local' || !take.available || !take.stream_path) return []
    const context: AiEditorDirectorContext = {
      planId: plan.id, planTitle: plan.title, mainContent: plan.main_content ?? '',
      planSignature: directorPlanContentSignature(plan), shotId: shot.id,
      shotOrder: shot.order, shotName: shot.name, attributes: shot.attributes,
      remark: shot.remark, suggestedDurationMs: shot.duration_ms,
      recipe: shot.shot_recipe, takeId: take.id, selectedRange: take.selected_range,
      markers: take.markers ?? [],
    }
    const capturedAt = take.captured_at ?? take.created_at
    return [{ filePath: path.resolve(take.stream_path), name: take.file_name,
      kind: take.kind === 'photo' ? 'image' as const : 'video' as const,
      capturedAt, groupDay: capturedAt.slice(0, 10),
      ...(take.duration_ms ? { duration: take.duration_ms / 1000 } : {}),
      directorContexts: [context],
    }]
  })))
}
