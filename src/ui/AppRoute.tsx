import { type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

interface AppRouteProps {
  /** 路由路径，如 '/workspace' */
  path: string
  children: ReactNode
  /**
   * 非活跃时是否保留 DOM。
   * - `true`（默认）：`hidden` 隐藏，切换回来保持状态
   * - `false`：直接 unmount，不保留
   */
  preserve?: boolean
  className?: string
}

/**
 * 带面板样式的路由容器，根据当前路径自动显隐。
 *
 * 用法：
 * ```tsx
 * <AppRoute path="/workspace">
 *   <WorkspacePage ... />
 * </AppRoute>
 * ```
 */
export function AppRoute({ path, children, preserve = true, className }: AppRouteProps) {
  const location = useLocation()
  const activePath = location.pathname === '/' ? '/library' : location.pathname
  const isActive = activePath === path

  if (!isActive && !preserve) return null

  return (
    <section className={`route-panel${className ? ` ${className}` : ''}`} hidden={!isActive}>
      {children}
    </section>
  )
}
