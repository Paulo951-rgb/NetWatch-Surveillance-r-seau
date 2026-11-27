import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react'
import { IconAlert, IconCheck, IconInfo, IconX } from '../components/Icons'

type ToastType = 'success' | 'error' | 'info' | 'warning'

interface ToastItem {
  id: number
  type: ToastType
  title: string
  message?: string
}

interface ToastApi {
  push: (type: ToastType, title: string, message?: string) => void
  success: (title: string, message?: string) => void
  error: (title: string, message?: string) => void
  info: (title: string, message?: string) => void
  warning: (title: string, message?: string) => void
}

const ToastContext = createContext<ToastApi>({
  push: () => undefined,
  success: () => undefined,
  error: () => undefined,
  info: () => undefined,
  warning: () => undefined
})

let counter = 0

export function ToastProvider({ children }: { children: ReactNode }): ReactNode {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const remove = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const push = useCallback(
    (type: ToastType, title: string, message?: string) => {
      const id = ++counter
      setToasts((current) => [...current.slice(-3), { id, type, title, message }])
      setTimeout(() => remove(id), type === 'error' ? 7000 : 4500)
    },
    [remove]
  )

  const api = useMemo<ToastApi>(
    () => ({
      push,
      success: (title, message) => push('success', title, message),
      error: (title, message) => push('error', title, message),
      info: (title, message) => push('info', title, message),
      warning: (title, message) => push('warning', title, message)
    }),
    [push]
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast ${toast.type}`}>
            <span className="toast-icon">
              {toast.type === 'success' ? (
                <IconCheck size={16} />
              ) : toast.type === 'error' ? (
                <IconAlert size={16} />
              ) : toast.type === 'warning' ? (
                <IconAlert size={16} />
              ) : (
                <IconInfo size={16} />
              )}
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="toast-title">{toast.title}</div>
              {toast.message ? <div className="toast-message">{toast.message}</div> : null}
            </div>
            <button className="btn icon sm ghost" onClick={() => remove(toast.id)} aria-label="Fermer">
              <IconX size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast(): ToastApi {
  return useContext(ToastContext)
}
