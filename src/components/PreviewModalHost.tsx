import { useCallback, useEffect, useMemo, useState } from 'react'
import { PreviewModal } from './PreviewModal'
import { filePathToLunaFile, thumbnailUrlForFile } from './previewModalUtils'
import { registerPreviewHost } from './previewModalService'
import type { LunaFile, WatermarkSettings as WatermarkSettingsType } from '../shared/types'

export interface PreviewOptions {
  onReveal?: (filePath: string) => void
  onDownload?: (file: LunaFile) => void
  onExportWithWatermark?: (file: LunaFile, settings: WatermarkSettingsType) => void
  isDownloadsPage?: boolean
  showWatermarkControls?: boolean
  autoPlayLive?: boolean
}

interface PreviewState {
  filePath: string
  fileList: string[]
  options: PreviewOptions
}

function guessKind(fp: string): 'image' | 'video' {
  return /\.(mp4|mov|avi|mkv|webm|wmv|mts|insv)$/i.test(fp) ? 'video' : 'image'
}

/** 全局预览弹窗宿主 — 放在 App 根层，通过 showPreviewModal() 触发 */
export function PreviewModalHost() {
  const [state, setState] = useState<PreviewState | null>(null)

  useEffect(() => {
    registerPreviewHost(setState)
    return () => registerPreviewHost(null as unknown as any)
  }, [])

  const handleClose = useCallback(() => setState(null), [])

  const handleReveal = useCallback(
    (file: LunaFile) => {
      const fp = file.downloadFilePath ?? file.localPath
      if (fp) state?.options.onReveal?.(fp)
    },
    [state],
  )

  const files: LunaFile[] = useMemo(
    () =>
      state?.fileList.map((fp) =>
        filePathToLunaFile(fp, {
          id: fp,
          kind: guessKind(fp),
          downloadName: fp.split(/[/\\]/).pop(),
          thumbnailUrl: thumbnailUrlForFile({ kind: guessKind(fp) }, fp),
        }),
      ) ?? [],
    [state?.fileList],
  )

  if (!state) return null

  return (
    <PreviewModal
      filePath={state.filePath}
      files={files}
      currentFile={files.find((f) => f.id === state.filePath) ?? files[0] ?? undefined}
      onFileChange={(f) => {
        setState((prev) => {
          if (!prev) return prev
          const idx = files.findIndex((pf) => pf.id === f.id)
          return idx >= 0 ? { ...prev, filePath: prev.fileList[idx] } : prev
        })
      }}
      onClose={handleClose}
      onReveal={handleReveal}
      onDownload={state.options.onDownload}
      onExportWithWatermark={state.options.onExportWithWatermark}
      isDownloadsPage={state.options.isDownloadsPage}
      showWatermarkControls={state.options.showWatermarkControls}
      autoPlayLive={state.options.autoPlayLive}
    />
  )
}
