import { useEffect, useState } from 'react'
// Minimal list loader: {data, loading, error, reload}. Keeps pages thin.
export function useList(loader, deps = []) {
  const [data, setData] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const reload = async () => {
    setLoading(true); setError('')
    try { const r = await loader(); setData(r?.results ?? r ?? []) }
    catch (e) { setError(e?.message || 'Failed to load.'); setData([]) }
    finally { setLoading(false) }
  }
  useEffect(() => { let live = true; setLoading(true)
    loader().then((r) => { if (live) setData(r?.results ?? r ?? []) }).catch((e) => { if (live) setError(e?.message || 'Failed to load.') }).finally(() => { if (live) setLoading(false) })
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  return { data, loading, error, reload, setData }
}
export function useTheme() {
  const [theme, setTheme] = useState(() => localStorage.getItem('expense_tracker_theme') || 'dark')
  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('expense_tracker_theme', theme)
  }, [theme])
  return { theme, toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')) }
}
