export type ToastType = 'info' | 'success' | 'error'

export interface ToastDetail {
  message: string
  type: ToastType
  duration: number
}

const TOAST_EVENT = 'luna:toast'

function dispatch(detail: ToastDetail) {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail }))
}

export const toast = {
  show(message: string, duration = 3000) {
    dispatch({ message, type: 'info', duration })
  },
  success(message: string, duration = 3000) {
    dispatch({ message, type: 'success', duration })
  },
  error(message: string, duration = 4000) {
    dispatch({ message, type: 'error', duration })
  },
  /** @internal */
  _eventName: TOAST_EVENT,
}
