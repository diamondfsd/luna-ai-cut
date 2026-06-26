import { createPortal } from 'react-dom'
import { useEffect, type ReactNode } from 'react'
import './modal-layer.css'

interface ModalLayerProps {
  onClose: () => void
  children: ReactNode
  /**
   * 遮罩层视觉风格
   * - `fullscreen`（默认）: 深色遮罩 + 强毛玻璃，用于 ExportModal / PreviewModal
   * - `dropdown`: 浅色遮罩 + 弱毛玻璃，用于下载 / 导出进度下拉面板
   */
  variant?: 'fullscreen' | 'dropdown'
}

/**
 * 统一的弹窗遮罩层组件。
 *
 * 通过 Portal 挂载到 document.body，彻底避免父级 backdrop-filter / transform / filter
 * 等 CSS 属性对 position:fixed 子元素的约束。
 *
 * 职责：
 * - Portal 到 document.body
 * - 全屏遮罩（点击关闭）
 * - Esc 键关闭
 * - 统一的 z-index 层级
 *
 * 子元素自行负责内容定位（position:fixed / flex 居中 / 绝对定位等）。
 * 需要自动聚焦和 Cmd+W 快捷键时使用 BaseModal（它内部使用 ModalLayer）。
 */
export function ModalLayer({ onClose, children, variant = 'fullscreen' }: ModalLayerProps) {
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [onClose])

  return createPortal(
    <div className={`modal-layer${variant === 'dropdown' ? ' is-dropdown' : ''}`} onClick={onClose}>
      <div className="modal-layer-content">
        {children}
      </div>
    </div>,
    document.body,
  )
}
