interface GimbalPosition {
  x: number
  y: number
}

interface LiveGimbalKeyboardOptions {
  window: Window
  document: Document
  isPadTarget: (target: EventTarget | null) => boolean
  isPointerActive: () => boolean
  onMove: (position: GimbalPosition) => void
  onStop: () => void
}

const DIRECTIONS: Record<string, GimbalPosition> = {
  KeyW: { x: 0, y: 0.5 },
  KeyA: { x: -0.5, y: 0 },
  KeyS: { x: 0, y: -0.5 },
  KeyD: { x: 0.5, y: 0 },
  ArrowUp: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowDown: { x: 0, y: -1 },
  ArrowRight: { x: 1, y: 0 },
}

export function bindLiveGimbalKeyboard(options: LiveGimbalKeyboardOptions): () => void {
  const pressedKeys = new Set<string>()
  let position: GimbalPosition = { x: 0, y: 0 }

  const update = () => {
    const next = { x: 0, y: 0 }
    for (const code of pressedKeys) {
      next.x += DIRECTIONS[code].x
      next.y += DIRECTIONS[code].y
    }
    const maximumSpeed = [...pressedKeys].some((code) => code.startsWith('Arrow')) ? 1 : 0.5
    const magnitude = Math.hypot(next.x, next.y)
    if (magnitude > maximumSpeed) {
      next.x *= maximumSpeed / magnitude
      next.y *= maximumSpeed / magnitude
    }
    if (next.x === position.x && next.y === position.y) return
    position = next
    if (next.x === 0 && next.y === 0) options.onStop()
    else options.onMove(next)
  }

  const stop = () => {
    pressedKeys.clear()
    update()
  }

  const keyDown = (event: KeyboardEvent) => {
    if (!DIRECTIONS[event.code]) return
    if (options.isPointerActive()) return
    if (event.defaultPrevented || event.isComposing || event.altKey || event.ctrlKey || event.metaKey) return
    const target = event.target
    if (target instanceof Element && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="dialog"], [role="alertdialog"], [role="combobox"], [role="slider"], [role="menu"]')) return
    if (event.code.startsWith('Arrow') && !options.isPadTarget(target)) return
    event.preventDefault()
    if (event.repeat || pressedKeys.has(event.code)) return
    pressedKeys.add(event.code)
    update()
  }

  const keyUp = (event: KeyboardEvent) => {
    if (!pressedKeys.delete(event.code)) return
    event.preventDefault()
    update()
  }

  const visibilityChange = () => {
    if (options.document.hidden) stop()
  }

  options.window.addEventListener('keydown', keyDown)
  options.window.addEventListener('keyup', keyUp)
  options.window.addEventListener('blur', stop)
  options.window.addEventListener('pointerdown', stop, true)
  options.document.addEventListener('focusin', stop)
  options.document.addEventListener('visibilitychange', visibilityChange)

  return () => {
    options.window.removeEventListener('keydown', keyDown)
    options.window.removeEventListener('keyup', keyUp)
    options.window.removeEventListener('blur', stop)
    options.window.removeEventListener('pointerdown', stop, true)
    options.document.removeEventListener('focusin', stop)
    options.document.removeEventListener('visibilitychange', visibilityChange)
    stop()
  }
}
