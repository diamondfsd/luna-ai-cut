/**
 * Adapter exports for timeline hook dependencies.
 * Editor modules should import timeline feature hooks from here.
 */

export {
  useTimelineShortcuts,
} from '@freecut/features/timeline/hooks/use-timeline-shortcuts'
export {
  useTransitionBreakageNotifications,
} from '@freecut/features/timeline/hooks/use-transition-breakage-notifications'
export { useFilmstrip } from '@freecut/features/timeline/hooks/use-filmstrip'
export type { FilmstripFrame } from '@freecut/features/timeline/hooks/use-filmstrip'
