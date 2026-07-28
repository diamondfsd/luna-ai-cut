import { Eye, EyeOff } from 'lucide-react'
import { useEffect, useRef } from 'react'

import { Button } from '../../../ui'

interface CreativeCompareButtonProps {
  active: boolean
  disabled?: boolean
  onActiveChange: (active: boolean) => void
  className?: string
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && Boolean(target.closest(
    'input, textarea, select, [contenteditable="true"], [role="textbox"]',
  ))
}

export function CreativeCompareButton({
  active,
  disabled = false,
  onActiveChange,
  className,
}: CreativeCompareButtonProps) {
  const keyboardActiveRef = useRef(false)
  const onActiveChangeRef = useRef(onActiveChange)
  onActiveChangeRef.current = onActiveChange

  useEffect(() => {
    if (disabled) {
      keyboardActiveRef.current = false
      onActiveChangeRef.current(false)
      return
    }

    function release(): void {
      keyboardActiveRef.current = false
      onActiveChangeRef.current(false)
    }

    function handleKeyDown(event: KeyboardEvent): void {
      if (event.code !== 'Space' || event.metaKey || event.ctrlKey || event.altKey || isTextEntryTarget(event.target)) return
      event.preventDefault()
      if (event.repeat || keyboardActiveRef.current) return
      keyboardActiveRef.current = true
      onActiveChangeRef.current(true)
    }

    function handleKeyUp(event: KeyboardEvent): void {
      if (event.code !== 'Space' || !keyboardActiveRef.current) return
      event.preventDefault()
      release()
    }

    function handleVisibilityChange(): void {
      if (document.hidden) release()
    }

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    window.addEventListener('blur', release)
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      window.removeEventListener('blur', release)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      release()
    }
  }, [disabled])

  return <Button
    className={className}
    variant={active ? 'toolbar-primary' : 'toolbar'}
    size="compact"
    icon={active ? <EyeOff size={14} /> : <Eye size={14} />}
    disabled={disabled}
    aria-pressed={active}
    title="按住空格或按钮查看原图"
    onPointerDown={() => onActiveChange(true)}
    onPointerUp={() => onActiveChange(false)}
    onPointerCancel={() => onActiveChange(false)}
    onPointerLeave={() => onActiveChange(false)}
    onBlur={() => onActiveChange(false)}
    onKeyDown={(event) => { if (event.key === 'Enter') onActiveChange(true) }}
    onKeyUp={(event) => { if (event.key === 'Enter') onActiveChange(false) }}
  >
    对比
  </Button>
}
