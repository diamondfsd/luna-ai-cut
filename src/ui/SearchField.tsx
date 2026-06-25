import type { InputHTMLAttributes, ReactNode } from 'react'
import { Search } from 'lucide-react'
import { Input } from './Input'

interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  icon?: ReactNode
}

export function SearchField({ icon = <Search size={16} />, ...props }: SearchFieldProps) {
  return <Input variant="pill" icon={icon} type="search" {...props} />
}
