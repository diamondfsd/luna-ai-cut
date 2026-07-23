import type { ReactNode } from 'react'

interface SegmentedOption<T extends string> {
  value: T
  label: ReactNode
}

interface SegmentedControlProps<T extends string> {
  ariaLabel?: string
  className?: string
  options: Array<SegmentedOption<T>>
  value: T
  onChange: (value: T) => void
  variant?: 'pill' | 'size'
}

export function SegmentedControl<T extends string>({
  ariaLabel,
  className,
  options,
  value,
  onChange,
  variant = 'pill',
}: SegmentedControlProps<T>) {
  return (
    <div className={className ?? (variant === 'size' ? 'size-switch' : 'segmented-pill')} aria-label={ariaLabel}>
      {options.map((option) => (
        <button
          className={value === option.value ? 'active' : ''}
          key={option.value}
          onClick={() => onChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
