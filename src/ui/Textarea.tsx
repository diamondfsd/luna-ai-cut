import { forwardRef, type TextareaHTMLAttributes } from 'react'
import { cx } from './utils'
import './input.css'
import './textarea.css'

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, rows = 5, ...props }, ref) {
    return <textarea ref={ref} rows={rows} className={cx('ui-input', 'ui-textarea', className)} {...props} />
  },
)
