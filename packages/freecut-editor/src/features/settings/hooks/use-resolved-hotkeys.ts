import { useShallow } from 'zustand/react/shallow'
import { resolveHotkeys } from '@freecut/config/hotkeys'
import { useSettingsStore } from '../stores/settings-store'

export function useResolvedHotkeys() {
  return useSettingsStore(useShallow((state) => resolveHotkeys(state.hotkeyOverrides)))
}
