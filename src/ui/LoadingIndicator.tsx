import { Loader2 } from 'lucide-react'

import { cx } from './utils'

interface LoadingIndicatorProps {
  label?: string
  size?: 'default' | 'large'
  variant?: 'plain' | 'media'
}

export function LoadingIndicator({ label, size = 'default', variant = 'plain' }: LoadingIndicatorProps) {
  return (
    <div className={cx('loading-indicator', size === 'large' && 'large', variant === 'media' && 'media')} aria-live="polite">
      <Loader2 className="spin" size={size === 'large' ? 34 : 22} />
      {label ? <span>{label}</span> : null}
    </div>
  )
}
