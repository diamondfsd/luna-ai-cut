import { useCallback, useState } from 'react'

/**
 * 截取状态管理 hook
 *
 * 管理截取模式开关，实际时间范围（startTime / endTime）存储在
 * EditPipeline.trim 中，通过 commitPatch 持久化。
 *
 * trimActive 仅表示 UI 是否处于截取布局模式。
 */
export function useTrimMachine() {
  const [trimActive, setTrimActive] = useState(false)

  const activateTrim = useCallback(() => {
    setTrimActive(true)
  }, [])

  const deactivateTrim = useCallback(() => {
    setTrimActive(false)
  }, [])

  return {
    trimActive,
    setTrimActive,
    activateTrim,
    deactivateTrim,
  }
}
