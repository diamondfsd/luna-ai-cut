import type { InputHTMLAttributes, ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from './Input'

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  icon?: ReactNode
  fullWidth?: boolean
  variant?: 'pill' | 'compact' | 'ghost'
  wrapperClassName?: string
}

export function SearchField({ icon = <Search size={16} />, variant = 'pill', ...props }: SearchFieldProps) {
  return <Input variant={variant} icon={icon} type="search" {...props} />
}
