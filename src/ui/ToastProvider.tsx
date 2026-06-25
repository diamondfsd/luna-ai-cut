import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { toast as toastApi, type ToastType } from './toast'
import './toast.css'

interface ToastItem {
  id: number
  message: string
  type: ToastType
}

let nextId = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const timersRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map())

  const remove = useCallback((id: number) => {
    setItems(prev => prev.filter(t => t.id !== id))
    const t = timersRef.current.get(id)
    if (t) {
      clearTimeout(t)
      timersRef.current.delete(id)
    }
  }, [])

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail
      const id = nextId++
      setItems(prev => [...prev, { id, message: detail.message, type: detail.type }])
      const timer = setTimeout(() => remove(id), detail.duration)
      timersRef.current.set(id, timer)
    }

    window.addEventListener(toastApi._eventName, handler)
    return () => {
      window.removeEventListener(toastApi._eventName, handler)
      timersRef.current.forEach(t => clearTimeout(t))
      timersRef.current.clear()
    }
  }, [remove])

  return (
    <>
      {children}
      {createPortal(
        <div className="toast-container" role="status" aria-live="polite">
          {items.map(t => (
            <div key={t.id} className={`toast-item ${t.type !== 'info' ? `toast-${t.type}` : ''}`} onClick={() => remove(t.id)}>
              {t.message}
            </div>
          ))}
        </div>,
        document.body,
      )}
    </>
  )
}
