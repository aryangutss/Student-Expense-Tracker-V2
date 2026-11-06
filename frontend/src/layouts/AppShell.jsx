import { useState } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { Banknote, BarChart3, CalendarClock, Home, Layers, List, LogOut, Menu, Moon, Plus, Settings, Sun, Target, Wallet } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useTheme } from '../hooks/useList.js'
import { useToast } from '../context/ToastContext.jsx'
import { categoriesApi } from '../services/api.js'
import { getMode } from '../services/mode.js'
import ExpenseForm from '../components/ExpenseForm.jsx'
import { Modal } from '../components/ui.jsx'

const LINKS = [
  { to: '/', label: 'Dashboard', icon: Home },
  { to: '/transactions', label: 'Transactions', icon: List },
  { to: '/income', label: 'Income', icon: Banknote },
  { to: '/budgets', label: 'Budgets', icon: Wallet },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/categories', label: 'Categories', icon: Layers },
  { to: '/recurring', label: 'Recurring', icon: CalendarClock },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/settings', label: 'Settings', icon: Settings },
]
export default function AppShell() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const { push } = useToast()
  const navigate = useNavigate()
  const [quickAdd, setQuickAdd] = useState(false)
  const [mobileMenu, setMobileMenu] = useState(false)
  const [categories, setCategories] = useState([])
  const mode = getMode()
  const openQuickAdd = async () => { try { const r = await categoriesApi.list({ page_size: 100 }); setCategories(r.results) } catch { setCategories([]) } setQuickAdd(true) }
  const doLogout = async () => { setMobileMenu(false); await logout(); push('Logged out.'); navigate('/login') }
  return <div className="shell">
    <aside className="sidebar" aria-label="Main navigation">
      <div className="brand"><span className="brand-mark"><Wallet size={20} color="#fff" /></span>Expense Tracker</div>
      <nav className="grid" style={{ gap: 2 }}>{LINKS.map(({ to, label, icon: Icon }) => (
        <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}><Icon size={18} />{label}</NavLink>
      ))}</nav>
      <div className="spacer" />
      <button type="button" className="btn btn-primary" onClick={openQuickAdd}><Plus size={16} /> Quick add expense</button>
      <div className="small muted" style={{ padding: '8px 10px' }}>
        {user?.username ? `Signed in as ${user.username}` : 'Signed in'} · {mode === 'local' ? 'On-device' : 'Server'}
      </div>
      <button type="button" className="btn" onClick={doLogout}><LogOut size={15} /> Log out</button>
    </aside>
    <div className="main">
      <div className="topbar">
        <button type="button" className="icon-btn mobile-only" aria-label="Open menu" onClick={() => setMobileMenu(true)}><Menu size={18} /></button>
        <button type="button" className="icon-btn" aria-label="Toggle theme" onClick={toggle}>{theme === 'dark' ? <Sun size={18} /> : <Moon size={18} />}</button>
        <span className="badge" title="Active storage mode">{mode === 'local' ? 'On-device' : 'Server'}</span>
        <div className="spacer" />
        <button type="button" className="btn btn-primary no-print" onClick={openQuickAdd}><Plus size={16} /> Quick add</button>
      </div>
      <Outlet />
    </div>
    <nav className="bottom-nav" aria-label="Mobile navigation">
      {LINKS.slice(0, 5).map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}><Icon size={20} />{label}</NavLink>)}
      <button type="button" className="bottom-nav-more" onClick={() => setMobileMenu(true)} aria-label="More pages"><Menu size={20} />More</button>
    </nav>
    {mobileMenu && <Modal title="Menu" onClose={() => setMobileMenu(false)}>
      <div className="grid" style={{ gap: 6 }}>
        {LINKS.map(({ to, label, icon: Icon }) => (
          <NavLink key={to} to={to} end={to === '/'} onClick={() => setMobileMenu(false)} className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}>
            <Icon size={18} />{label}
          </NavLink>
        ))}
        <hr style={{ border: 'none', borderTop: '1px solid var(--border)', margin: '8px 0' }} />
        <div className="small muted" style={{ padding: '4px 8px' }}>
          {user?.username ? `Signed in as ${user.username}` : 'Signed in'} ({mode === 'local' ? 'On-device storage' : 'Server mode'})
        </div>
        <button type="button" className="btn btn-danger" onClick={doLogout}><LogOut size={16} /> Log out</button>
      </div>
    </Modal>}
    {quickAdd && <Modal title="Quick add expense" onClose={() => setQuickAdd(false)}>
      <ExpenseForm categories={categories} onSaved={() => { setQuickAdd(false); navigate('/transactions') }} onCancel={() => setQuickAdd(false)} />
    </Modal>}
  </div>
}
