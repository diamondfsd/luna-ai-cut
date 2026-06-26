/**
 * 纯函数：计算 object-fit: contain 后内容在容器中的真实显示矩形
 */
export interface ContainRect {
  x: number
  y: number
  width: number
  height: number
  scale: number
}

export function getContainRect(
  containerW: number,
  containerH: number,
  contentW: number,
  contentH: number,
): ContainRect {
  if (contentW <= 0 || contentH <= 0) {
    return { x: 0, y: 0, width: 0, height: 0, scale: 1 }
  }
  const scale = Math.min(containerW / contentW, containerH / contentH)
  const renderW = contentW * scale
  const renderH = contentH * scale
  return {
    x: (containerW - renderW) / 2,
    y: (containerH - renderH) / 2,
    width: renderW,
    height: renderH,
    scale,
  }
}
