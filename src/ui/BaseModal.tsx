import { useEffect, useRef, type ReactNode } from 'react'

import { ModalLayer } from './ModalLayer'

interface BaseModalProps {
  onClose: () => void
  children: ReactNode
}

/**
 * 全屏弹窗基底组件。
 *
 * 基于 ModalLayer，额外增加：
 * - 内容区域自动居中
 * - 弹窗挂载时自动聚焦（让键盘事件生效）
 * - Cmd+W / Ctrl+W 快捷键关闭
 *
 * 子元素需自行负责内部布局样式（如 `.preview-modal` 网格布局）。
 * 不需要 Cmd+W 和自动聚焦时可直接使用 ModalLayer。
 */
export function BaseModal({ onClose, children }: BaseModalProps) {
  const contentRef = useRef<HTMLDivElement | null>(null)

  // 挂载时聚焦弹窗，让键盘事件生效
  useEffect(() => {
    const id = window.setTimeout(() => contentRef.current?.focus(), 0)
    return () => window.clearTimeout(id)
  }, [])

  // Cmd+W / Ctrl+W 关闭弹窗（Esc 由 ModalLayer 处理）
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
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
    <ModalLayer onClose={onClose}>
      <div
        ref={contentRef}
        tabIndex={-1}
        onClick={(event) => event.stopPropagation()}
        style={{ display: 'grid', placeItems: 'center', width: '100%', height: '100%', outline: 'none' }}
      >
        {children}
      </div>
    </ModalLayer>
  )
}
