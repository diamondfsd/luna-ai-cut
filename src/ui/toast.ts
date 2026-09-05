export type ToastType = 'info' | 'success' | 'error'

export interface ToastDetail {
  message: string
  type: ToastType
  duration: number
}

const TOAST_EVENT = 'luna:toast'
const MAX_TOAST_DURATION = 3000

const PARENTHETICAL_TEXT = /（[^（）]*）|\([^()]*\)/g

export function normalizeToastMessage(message: string): string {
  let normalized = message
  let previous = ''

  while (normalized !== previous) {
    previous = normalized
    normalized = normalized.replace(PARENTHETICAL_TEXT, '')
  }

  return normalized
    .replace(/[（）()]/g, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/\s+([，。！？：；,.!?])/g, '$1')
    .trim()
}

function dispatch(detail: ToastDetail) {
  const message = normalizeToastMessage(detail.message)
  if (!message) return
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, {
    detail: { ...detail, message, duration: Math.min(detail.duration, MAX_TOAST_DURATION) },
  }))
}

export const toast = {
  show(message: string, duration = 3000) {
    dispatch({ message, type: 'info', duration })
  },
  success(message: string, duration = 3000) {
    dispatch({ message, type: 'success', duration })
  },
  error(message: string, duration = 3000) {
    dispatch({ message, type: 'error', duration })
  },
  /** @internal */
  _eventName: TOAST_EVENT,
}
