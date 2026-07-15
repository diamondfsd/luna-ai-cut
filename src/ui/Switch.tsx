import { Switch as RadixSwitch } from 'radix-ui'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  ariaLabel: string
  disabled?: boolean
}

export function Switch({ checked, onCheckedChange, ariaLabel, disabled }: SwitchProps) {
  return (
    <RadixSwitch.Root className="toggle-switch" checked={checked} onCheckedChange={onCheckedChange} aria-label={ariaLabel} disabled={disabled}>
      <RadixSwitch.Thumb className="toggle-thumb" />
    </RadixSwitch.Root>
  )
}
