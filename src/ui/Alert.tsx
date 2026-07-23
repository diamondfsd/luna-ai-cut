import { type ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import './alert.css'

export type AlertVariant = 'info' | 'error' | 'warning' | 'success'

export interface AlertProps {
  variant?: AlertVariant
  message?: string
  children?: ReactNode
}

const iconMap: Record<AlertVariant, ReactNode> = {
  info: <Info size={16} />,
  error: <AlertCircle size={16} />,
  warning: <AlertTriangle size={16} />,
  success: <CheckCircle2 size={16} />,
}

export function Alert({ variant = 'info', message, children }: AlertProps) {
  return (
    <div className={`alert alert-${variant}`}>
      <span className="alert-icon">{iconMap[variant]}</span>
      <span className="alert-text">{message ?? children}</span>
    </div>
  )
}
