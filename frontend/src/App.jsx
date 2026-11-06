import { useEffect } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './context/AuthContext.jsx'
import { ToastProvider } from './context/ToastContext.jsx'
import AppShell from './layouts/AppShell.jsx'
import { Login, Register } from './pages/Auth.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Transactions from './pages/Transactions.jsx'
import Income from './pages/Income.jsx'
import Budgets from './pages/Budgets.jsx'
import Analytics from './pages/Analytics.jsx'
import Categories from './pages/Categories.jsx'
import Recurring from './pages/Recurring.jsx'
import Goals from './pages/Goals.jsx'
import Settings from './pages/Settings.jsx'
import { Skeleton } from './components/ui.jsx'

const GLOW_SELECTOR =
  'button, a, .btn, .icon-btn, .nav-link, .bottom-nav-more, .tx-row, .pie-legend-pill, .stat-card, .card, .import-dropzone, input, select, textarea'

function ClickGlowManager() {
  useEffect(() => {
    const onPointerDown = (e) => {
      const target = e.target?.closest?.(GLOW_SELECTOR)
      if (target) {
        const rect = target.getBoundingClientRect()
        const x = `${Math.round(e.clientX - rect.left)}px`
        const y = `${Math.round(e.clientY - rect.top)}px`
        target.style.setProperty('--click-x', x)
        target.style.setProperty('--click-y', y)
        target.classList.remove('glow-click-active')
        // Trigger reflow so rapid taps restart the glow bloom animation
        void target.offsetWidth
        target.classList.add('glow-click-active')
        window.setTimeout(() => {
          target.classList.remove('glow-click-active')
        }, 560)
      }

      if (typeof e.clientX === 'number' && typeof e.clientY === 'number' && (e.clientX > 0 || e.clientY > 0)) {
        const orb = document.createElement('span')
        orb.className = 'click-glow-ripple'
        orb.style.left = `${e.clientX}px`
        orb.style.top = `${e.clientY}px`
        document.body.appendChild(orb)
        window.setTimeout(() => {
          orb.remove()
        }, 540)
      }
    }
    window.addEventListener('pointerdown', onPointerDown, { passive: true })
    return () => window.removeEventListener('pointerdown', onPointerDown)
  }, [])
  return null
}

function Protected({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: 24 }}><Skeleton lines={4} /></div>
  if (!user) return <Navigate to="/login" replace />
  return children
}
function GuestOnly({ children }) {
  const { user, loading } = useAuth()
  if (loading) return <div style={{ padding: 24 }}><Skeleton lines={3} /></div>
  if (user) return <Navigate to="/" replace />
  return children
}
export default function App() {
  return <ToastProvider><AuthProvider>
    <ClickGlowManager />
    <Routes>
      <Route path="/login" element={<GuestOnly><Login /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><Register /></GuestOnly>} />
      <Route element={<Protected><AppShell /></Protected>}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/transactions" element={<Transactions />} />
        <Route path="/income" element={<Income />} />
        <Route path="/budgets" element={<Budgets />} />
        <Route path="/analytics" element={<Analytics />} />
        <Route path="/categories" element={<Categories />} />
        <Route path="/recurring" element={<Recurring />} />
        <Route path="/goals" element={<Goals />} />
        <Route path="/settings" element={<Settings />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </AuthProvider></ToastProvider>
}
