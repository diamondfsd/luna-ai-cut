export interface ContactSheetAnnotationCell {
  readonly frameId: string
  readonly sheetIndex: number
  readonly x: number
  readonly y: number
  readonly width: number
  readonly height: number
}

export interface ContactSheetAnnotationFrame {
  readonly frameId: string
  readonly mediaId: string
  readonly frameIndex: number
  readonly timeSec: number
  readonly name: string
  readonly kind: "image" | "video"
  readonly capturedAt: string | null
  readonly base64: string
}

export interface ContactSheetAnnotationSheet {
  readonly base64: string
  readonly mimeType: string
  readonly width: number
  readonly height: number
  readonly cells: readonly ContactSheetAnnotationCell[]
}

export interface AnnotatedContactSheet {
  readonly base64: string
  readonly labeled: boolean
}

const LABEL_FONT = "600 12px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const DETAIL_FONT = "500 11px -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
const LABEL_HEIGHT = 36

export function contactSheetFrameLabel(sheetIndex: number): string {
  return `#${String(sheetIndex + 1).padStart(2, "0")}`
}

export function formatContactSheetFrameTime(timeSec: number): string {
  const safeTime = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0
  const tenths = Math.round(safeTime * 10)
  const totalSeconds = Math.floor(tenths / 10)
  const tenth = tenths % 10
  const seconds = totalSeconds % 60
  const totalMinutes = Math.floor(totalSeconds / 60)
  const minutes = totalMinutes % 60
  const hours = Math.floor(totalMinutes / 60)
  const secondText = `${String(seconds).padStart(2, "0")}.${tenth}`
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${secondText}`
  return `${String(minutes).padStart(2, "0")}:${secondText}`
}

export function formatContactSheetCaptureTime(capturedAt: string | null): string | null {
  if (!capturedAt) return null
  const match = capturedAt.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2})/)
  return match ? `${match[1]} ${match[2]}` : capturedAt.slice(0, 16)
}

export function contactSheetFrameTimeLabel(frame: Pick<ContactSheetAnnotationFrame, "kind" | "timeSec" | "capturedAt">): string {
  if (frame.kind === "video") return `时间 ${formatContactSheetFrameTime(frame.timeSec)}`
  return `拍摄 ${formatContactSheetCaptureTime(frame.capturedAt) ?? "未知"}`
}

export function buildContactSheetIndexText(
  frames: readonly ContactSheetAnnotationFrame[],
  cells: readonly ContactSheetAnnotationCell[],
): string {
  const cellsByFrameId = new Map(cells.map((cell) => [cell.frameId, cell]))
  const orderedFrames = [...frames].sort((left, right) => (
    (cellsByFrameId.get(left.frameId)?.sheetIndex ?? Number.MAX_SAFE_INTEGER)
    - (cellsByFrameId.get(right.frameId)?.sheetIndex ?? Number.MAX_SAFE_INTEGER)
  ))
  const lines = ["联络表图片中的编号对应以下素材；后续操作请使用 mediaId 和 frameId，不要按图片顺序猜测。"]
  for (const frame of orderedFrames) {
    const cell = cellsByFrameId.get(frame.frameId)
    const label = cell ? contactSheetFrameLabel(cell.sheetIndex) : `frame ${frame.frameIndex + 1}`
    const kind = frame.kind === "video" ? "VIDEO" : "PHOTO"
    lines.push(`${label} | ${frame.name} | ${kind} | ${contactSheetFrameTimeLabel(frame)} | mediaId=${frame.mediaId} | frameId=${frame.frameId}`)
  }
  return lines.join("\n")
}

function fitCanvasText(context: CanvasRenderingContext2D, value: string, maxWidth: number): string {
  if (context.measureText(value).width <= maxWidth) return value
  const suffix = "..."
  let end = value.length
  while (end > 0 && context.measureText(`${value.slice(0, end)}${suffix}`).width > maxWidth) end -= 1
  return end > 0 ? `${value.slice(0, end)}${suffix}` : suffix
}

function drawContainedImage(
  context: CanvasRenderingContext2D,
  image: HTMLImageElement,
  cell: ContactSheetAnnotationCell,
): void {
  const sourceWidth = image.naturalWidth || image.width
  const sourceHeight = image.naturalHeight || image.height
  if (!sourceWidth || !sourceHeight) throw new Error("预览帧尺寸不可用")
  const scale = Math.min(cell.width / sourceWidth, cell.height / sourceHeight)
  const width = sourceWidth * scale
  const height = sourceHeight * scale
  context.fillStyle = "#111820"
  context.fillRect(cell.x, cell.y, cell.width, cell.height)
  context.drawImage(
    image,
    cell.x + (cell.width - width) / 2,
    cell.y + (cell.height - height) / 2,
    width,
    height,
  )
}

function drawFrameLabel(
  context: CanvasRenderingContext2D,
  frame: ContactSheetAnnotationFrame,
  cell: ContactSheetAnnotationCell,
): void {
  const labelHeight = Math.min(LABEL_HEIGHT, Math.max(28, cell.height))
  const labelTop = cell.y + cell.height - labelHeight
  const label = contactSheetFrameLabel(cell.sheetIndex)
  const type = frame.kind === "video" ? "VIDEO" : "PHOTO"
  const timeLabel = contactSheetFrameTimeLabel(frame)
  context.fillStyle = "rgba(8, 12, 16, 0.86)"
  context.fillRect(cell.x, labelTop, cell.width, labelHeight)

  context.font = LABEL_FONT
  context.fillStyle = "#ffffff"
  context.fillText(label, cell.x + 8, labelTop + 14)
  context.font = DETAIL_FONT
  context.fillStyle = "#d5dde7"
  context.fillText(type, cell.x + cell.width - 48, labelTop + 14)

  context.font = DETAIL_FONT
  context.fillStyle = "#b8c3cf"
  const time = fitCanvasText(context, timeLabel, Math.max(40, cell.width - 16))
  const timeWidth = context.measureText(time).width
  context.fillText(time, cell.x + cell.width - timeWidth - 8, labelTop + 27)

  context.font = LABEL_FONT
  const name = fitCanvasText(context, frame.name, Math.max(40, cell.width - timeWidth - 24))
  context.fillStyle = "#ffffff"
  context.fillText(name, cell.x + 8, labelTop + 27)
}

function loadContactSheetImage(base64: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error("联络表预览帧读取失败"))
    image.src = `data:image/jpeg;base64,${base64}`
  })
}

export async function annotateContactSheet(
  sheet: ContactSheetAnnotationSheet,
  frames: readonly ContactSheetAnnotationFrame[],
): Promise<AnnotatedContactSheet> {
  if (
    typeof document === "undefined"
    || typeof Image === "undefined"
    || frames.length === 0
    || frames.some((frame) => !frame.base64)
  ) {
    return { base64: sheet.base64, labeled: false }
  }

  const cells = new Map(sheet.cells.map((cell) => [cell.frameId, cell]))
  const canvas = document.createElement("canvas")
  canvas.width = sheet.width
  canvas.height = sheet.height
  const context = canvas.getContext("2d")
  if (!context) return { base64: sheet.base64, labeled: false }

  try {
    context.fillStyle = "#111820"
    context.fillRect(0, 0, sheet.width, sheet.height)
    for (const frame of frames) {
      const cell = cells.get(frame.frameId)
      if (!cell) throw new Error("联络表帧坐标缺失")
      const image = await loadContactSheetImage(frame.base64)
      drawContainedImage(context, image, cell)
      drawFrameLabel(context, frame, cell)
    }
    const dataUrl = canvas.toDataURL("image/jpeg", 0.88)
    const separator = dataUrl.indexOf(",")
    if (separator < 0 || separator === dataUrl.length - 1) throw new Error("联络表编码失败")
    return { base64: dataUrl.slice(separator + 1), labeled: true }
  } catch {
    return { base64: sheet.base64, labeled: false }
  }
}
