import { Slider as RadixSlider } from 'radix-ui'

import { cx } from './utils'

interface SliderProps {
  value: number
  min: number
  max: number
  step?: number
  ariaLabel: string
  disabled?: boolean
  className?: string
  onValueChange?: (value: number) => void
  onValueCommit?: (value: number) => void
}

export function Slider({ value, min, max, step = 1, ariaLabel, disabled, className, onValueChange, onValueCommit }: SliderProps) {
  return <RadixSlider.Root
    className={cx('ui-slider', className)}
    value={[value]}
    min={min}
    max={max}
    step={step}
    disabled={disabled}
    onValueChange={([next]) => onValueChange?.(next)}
    onValueCommit={([next]) => onValueCommit?.(next)}
  >
    <RadixSlider.Track className="ui-slider-track"><RadixSlider.Range className="ui-slider-range" /></RadixSlider.Track>
    <RadixSlider.Thumb className="ui-slider-thumb" aria-label={ariaLabel} />
  </RadixSlider.Root>
}
