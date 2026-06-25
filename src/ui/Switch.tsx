import * as RadixSwitch from '@radix-ui/react-switch'

interface SwitchProps {
  checked: boolean
  onCheckedChange: (checked: boolean) => void
  ariaLabel: string
}

export function Switch({ checked, onCheckedChange, ariaLabel }: SwitchProps) {
  return (
    <RadixSwitch.Root className="toggle-switch" checked={checked} onCheckedChange={onCheckedChange} aria-label={ariaLabel}>
      <RadixSwitch.Thumb className="toggle-thumb" />
    </RadixSwitch.Root>
  )
}
