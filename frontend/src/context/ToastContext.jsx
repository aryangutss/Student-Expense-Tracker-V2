/* eslint-disable react-refresh/only-export-components -- context file intentionally co-exports its hook and provider. */
import { createContext, useCallback, useContext, useRef, useState } from 'react'
const Ctx = createContext(null)
export const useToast = () => useContext(Ctx)
export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([])
  const idRef = useRef(0)
  const push = useCallback((message, kind = 'success') => {
    const id = ++idRef.current
    setToasts((t) => [...t, { id, message, kind }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500)
  }, [])
  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), [])
  return <Ctx.Provider value={{ push, dismiss }}>{children}<div className="toast-stack" role="status" aria-live="polite">{toasts.map((t) => (
    <button key={t.id} type="button" className={`toast toast-${t.kind}`} onClick={() => dismiss(t.id)}>{t.message}</button>
  ))}</div></Ctx.Provider>
}
