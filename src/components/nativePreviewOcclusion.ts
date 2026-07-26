const NATIVE_PREVIEW_OVERLAY_SELECTOR = [
  '.ui-dialog-overlay',
  '.ui-dialog-content',
  '.modal-layer',
  '.ui-popover-content',
  '.ui-select-content',
  '.ui-context-menu-content',
  '[data-native-preview-overlay]',
].join(',')

function rectanglesIntersect(left: DOMRect, right: DOMRect): boolean {
  return left.left < right.right
    && left.right > right.left
    && left.top < right.bottom
    && left.bottom > right.top
}

function isVisible(element: HTMLElement): boolean {
  const style = window.getComputedStyle(element)
  if (style.display === 'none' || style.visibility === 'hidden') return false
  const rect = element.getBoundingClientRect()
  return rect.width > 0 && rect.height > 0
}

export function isNativePreviewOccluded(canvas: HTMLElement): boolean {
  const canvasRect = canvas.getBoundingClientRect()
  if (canvasRect.width <= 0 || canvasRect.height <= 0) return false
  return Array.from(
    document.querySelectorAll<HTMLElement>(NATIVE_PREVIEW_OVERLAY_SELECTOR),
  ).some((element) => (
    element !== canvas
    && isVisible(element)
    && rectanglesIntersect(canvasRect, element.getBoundingClientRect())
  ))
}
