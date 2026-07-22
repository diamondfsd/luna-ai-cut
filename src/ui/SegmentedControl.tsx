import type { ReactNode } from 'react'

import { ButtonGroup } from './ButtonGroup'

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
    <ButtonGroup
      ariaLabel={ariaLabel}
      className={className ?? (variant === 'size' ? 'size-switch' : 'segmented-pill')}
      options={options}
      value={value}
      onChange={onChange}
    />
  )
}
