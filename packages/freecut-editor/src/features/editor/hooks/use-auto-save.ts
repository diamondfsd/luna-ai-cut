import { useEffect } from 'react'
import { toast } from 'sonner'
import { createLogger } from '@freecut/shared/logging/logger'
import { i18n } from '@freecut/i18n'

export const AUTO_SAVE_DELAY_MS = 1_500

const logger = createLogger('AutoSave')

interface UseAutoSaveOptions {
  /** Whether there are unsaved changes */
  isDirty: boolean
  /** Changes whenever the editable project content changes. */
  changeVersion: number
  /** Function to call when auto-saving */
  onSave: () => Promise<void>
  /** Whether auto-save is enabled (can be used to disable during export, etc.) */
  enabled?: boolean
}

/**
 * Saves shortly after editing stops. Further edits reset the delay.
 *
 * @example
 * useAutoSave({
 *   isDirty,
 *   onSave: handleSave,
 * });
 */
export function useAutoSave({
  isDirty,
  changeVersion,
  onSave,
  enabled = true,
}: UseAutoSaveOptions) {
  useEffect(() => {
    if (!isDirty || !enabled) {
      return
    }

    const timeoutId = window.setTimeout(async () => {
      const event = logger.startEvent('save')
      event.set('delay_ms', AUTO_SAVE_DELAY_MS)

      try {
        await onSave()
        event.success()
      } catch (error) {
        event.failure(error)
        toast.error(i18n.t('editor.autoSave.failed'))
      }
    }, AUTO_SAVE_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [changeVersion, isDirty, onSave, enabled])
}
