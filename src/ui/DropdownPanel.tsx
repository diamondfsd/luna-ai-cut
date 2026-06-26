import { useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'

import { ModalLayer, Panel, PanelBody, PanelHeader } from '.'
import './dropdown-panel.css'

interface DropdownPanelProps {
  /** 面板是否打开 */
  open: boolean
  /** 触发面板的按钮元素 ref，用于计算面板定位 */
  triggerRef: RefObject<Element | null>
  /** 关闭回调 */
  onClose: () => void
  /** 面板标题 */
  title: ReactNode
  /** 面板主体内容 */
  children: ReactNode
  /** 头部右侧的操作按钮区域（如取消按钮） */
  headerActions?: ReactNode
}

/**
 * 下拉面板组件。
 *
 * 封装了 ModalLayer（遮罩 + Portal + Esc 关闭）+ 定位计算 + Panel 布局，
 * 调用方只需提供内容，无需编写 PanelHeader / PanelBody 等样板代码。
 */
export function DropdownPanel({ open, triggerRef, onClose, title, children, headerActions }: DropdownPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const [panelStyle, setPanelStyle] = useState<React.CSSProperties>({})

  // 面板打开时计算相对于触发按钮的 fixed 定位（用 useLayoutEffect 避免闪烁）
  useLayoutEffect(() => {
    if (!open) return
    const rect = triggerRef.current?.getBoundingClientRect()
    if (rect) {
      setPanelStyle({
        position: 'fixed',
        top: rect.bottom + 6,
        right: window.innerWidth - rect.right,
      })
    }
  }, [open, triggerRef])

  if (!open) return null

  return (
    <ModalLayer variant="dropdown" onClose={onClose}>
      <Panel
        ref={panelRef}
        className="ui-dropdown-panel"
        style={panelStyle}
        onClick={(event) => event.stopPropagation()}
      >
        <PanelHeader>
          <h2 className="ui-dropdown-panel-title">{title}</h2>
          {headerActions}
        </PanelHeader>
        <PanelBody>{children}</PanelBody>
      </Panel>
    </ModalLayer>
  )
}
