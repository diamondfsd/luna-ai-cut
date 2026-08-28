import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { PreviewModal } from './PreviewModal'
import type { PreviewState } from './previewModalService'
import { registerPreviewHost } from './previewModalService'

/** 全局预览弹窗宿主 — 放在 App 根层，通过 showPreviewModal() 触发 */
export function PreviewModalHost() {
  const [state, setState] = useState<PreviewState | null>(null)
  const location = useLocation()
  const routePathRef = useRef(location.pathname)

  useEffect(() => {
    const unregister = registerPreviewHost(setState)
    return () => unregister?.()
  }, [])

  useEffect(() => {
    if (routePathRef.current !== location.pathname) setState(null)
    routePathRef.current = location.pathname
  }, [location.pathname])

  const handleClose = useCallback(() => setState(null), [])

  if (!state) return null

  return (
    <PreviewModal
      filePath={state.filePath}
      filePathList={state.fileList}
      previewOnly={state.previewOnly}
      lightweightPreview={state.lightweightPreview}
      batchExportMode={state.batchExportMode}
      enableILogRestoreOption={state.enableILogRestoreOption}
      mediaFileForPath={state.mediaFileForPath}
      onFilePathChange={state.onFilePathChange}
      isFileSelected={state.isFileSelected}
      onSetFileSelected={state.onSetFileSelected}
      onClose={handleClose}
    />
  )
}
