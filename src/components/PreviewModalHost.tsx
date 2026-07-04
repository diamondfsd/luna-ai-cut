import { useCallback, useEffect, useState } from 'react'
import { PreviewModal } from './PreviewModal'
import { registerPreviewHost } from './previewModalService'

/** 全局预览弹窗宿主 — 放在 App 根层，通过 showPreviewModal() 触发 */
export function PreviewModalHost() {
  const [state, setState] = useState<{ filePath: string; fileList: string[] } | null>(null)

  useEffect(() => {
    registerPreviewHost(setState)
    return () => registerPreviewHost(null as unknown as any)
  }, [])

  const handleClose = useCallback(() => setState(null), [])

  if (!state) return null

  return (
    <PreviewModal
      filePath={state.filePath}
      filePathList={state.fileList}
      onClose={handleClose}
    />
  )
}
