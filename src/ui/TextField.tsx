/**
 * @deprecated 请使用 `Input` 组件代替，TextField 将在未来版本中移除。
 */

import type { InputHTMLAttributes } from 'react'
import { cx } from './utils'

/** @deprecated 使用 `Input variant="pill"` 代替 */
export function TextField({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx('host-field', className)} {...props} />
}
