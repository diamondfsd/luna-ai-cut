import type { LunaFile, WatermarkSettings as WatermarkSettingsType } from '../shared/types'

export interface PreviewOptions {
  onReveal?: (filePath: string) => void
  onDownload?: (file: LunaFile) => void
  onExportWithWatermark?: (file: LunaFile, settings: WatermarkSettingsType) => void
  isDownloadsPage?: boolean
  showWatermarkControls?: boolean
  autoPlayLive?: boolean
}

export interface PreviewState {
  filePath: string
  fileList: string[]
  options: PreviewOptions
}

type SetStateFn = (state: PreviewState | null) => void
let setPreviewState: SetStateFn | null = null

export function registerPreviewHost(setter: SetStateFn): void {
  setPreviewState = setter
}

/** 打开预览弹窗。fileList 传文件路径数组用于导航，不传则只有单文件预览。 */
export function showPreviewModal(
  filePath: string,
  fileList?: string[],
  options: PreviewOptions = {},
): void {
  setPreviewState?.({ filePath, fileList: fileList ?? [filePath], options })
}

export function closePreviewModal(): void {
  setPreviewState?.(null)
}
