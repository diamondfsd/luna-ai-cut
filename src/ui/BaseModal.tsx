import { useEffect, useRef, type ReactNode } from 'react'

interface BaseModalProps {
  onClose: () => void
  children: ReactNode
}

/**
 * 全屏弹窗基底组件。
 *
 * 提供：
 * - 毛玻璃背景遮罩，点击背景关闭
 * - Esc / Ctrl+W / Cmd+W 快捷键关闭（兼容 Win/Mac）
 * - 弹窗挂载时自动聚焦
 *
 * 子元素需自行负责布局样式（如 `.preview-modal` 网格布局）。
 */
export function BaseModal({ onClose, children }: BaseModalProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)

  // 挂载时聚焦弹窗，让键盘事件生效
  useEffect(() => {
    const id = window.setTimeout(() => contentRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [])

  // Esc / Ctrl+W / Cmd+W 关闭弹窗
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.stopPropagation()
        onClose()
        return
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'w') {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true })
  }, [onClose])

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        ref={contentRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{ outline: 'none' }}
      >
        {children}
      </div>
    </div>
  )
}
