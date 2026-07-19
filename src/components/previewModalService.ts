export interface PreviewState {
  filePath: string
  fileList: string[]
  /** true 表示仅查看已导出的文件，隐藏水印配置和导出按钮，用原生 img/video 渲染 */
  previewOnly?: boolean
  /** true 表示批量导出模式，显示"导出全部"按钮 */
  batchExportMode?: boolean
  /** 预览内切换素材时同步外部选中项。 */
  onFilePathChange?: (filePath: string) => void
}

interface PreviewModalOptions {
  onFilePathChange?: (filePath: string) => void
}

type SetStateFn = (state: PreviewState | null) => void
let setPreviewState: SetStateFn | null = null

export function registerPreviewHost(setter: SetStateFn): () => void {
  setPreviewState = setter
  return () => { setPreviewState = null }
}

/** 打开预览弹窗。fileList 传文件路径数组用于导航，不传则只有单文件预览。 */
export function showPreviewModal(
  filePath: string,
  fileList?: string[],
  previewOnly?: boolean,
  options?: PreviewModalOptions,
): void {
  const candidates = fileList ?? [filePath]
  const visibleFiles = previewOnly
    ? candidates.filter((path) => !/apple[-_]?live/i.test(path))
    : candidates
  if (visibleFiles.length === 0) return
  const visibleFilePath = visibleFiles.includes(filePath) ? filePath : visibleFiles[0]
  setPreviewState?.({ filePath: visibleFilePath, fileList: visibleFiles, previewOnly, ...options })
}

/** 打开批量导出弹窗 */
export function showBatchExportModal(
  filePath: string,
  fileList: string[],
): void {
  setPreviewState?.({ filePath, fileList, batchExportMode: true })
}
