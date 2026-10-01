import { Progress as RadixProgress } from 'radix-ui'
import './progress-bar.css'

interface ProgressBarProps {
  value: number
  ariaLabel: string
}

export function ProgressBar({ value, ariaLabel }: ProgressBarProps) {
  const percent = Math.max(0, Math.min(100, value))
  return <RadixProgress.Root className="ui-progress-bar" value={percent} max={100} aria-label={ariaLabel}>
    <RadixProgress.Indicator className="ui-progress-bar-indicator" style={{ width: `${percent}%` }} />
  </RadixProgress.Root>
}
