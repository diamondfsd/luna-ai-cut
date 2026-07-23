import { useCallback, useEffect, useState } from 'react'
import { PreviewModal } from './PreviewModal'
import type { PreviewState } from './previewModalService'
import { registerPreviewHost } from './previewModalService'

/** 全局预览弹窗宿主 — 放在 App 根层，通过 showPreviewModal() 触发 */
export function PreviewModalHost() {
  const [state, setState] = useState<PreviewState | null>(null)

  useEffect(() => {
    const unregister = registerPreviewHost(setState)
    return () => unregister?.()
  }, [])

  const handleClose = useCallback(() => setState(null), [])

  if (!state) return null

  return (
    <PreviewModal
      filePath={state.filePath}
      filePathList={state.fileList}
      previewOnly={state.previewOnly}
      batchExportMode={state.batchExportMode}
      onClose={handleClose}
    />
  )
}
