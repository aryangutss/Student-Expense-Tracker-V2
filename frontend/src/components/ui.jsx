import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle, Book, Car, Coffee, Film, Gamepad2, GraduationCap,
  Heart, HeartPulse, Home, Inbox, Loader2, Package, Plane, Repeat,
  ShoppingBag, Sparkles, Utensils, Wallet,
} from 'lucide-react'

const ICON_MAP = {
  utensils: Utensils,
  car: Car,
  'graduation-cap': GraduationCap,
  home: Home,
  'shopping-bag': ShoppingBag,
  film: Film,
  'heart-pulse': HeartPulse,
  repeat: Repeat,
  sparkles: Sparkles,
  package: Package,
  book: Book,
  'gamepad-2': Gamepad2,
  heart: Heart,
  plane: Plane,
  coffee: Coffee,
  wallet: Wallet,
}

export function GlassCard({ children, className = '', style }) { return <section className={`glass card ${className}`} style={style}>{children}</section> }
export function StatCard({ icon, label, value, sub, accentColor }) {
  return (
    <GlassCard className="stat-card">
      <div className="stat-label">
        {icon && <span className="stat-icon-badge" style={accentColor ? { color: accentColor, borderColor: `${accentColor}44`, background: `${accentColor}18` } : undefined}>{icon}</span>}
        {label}
      </div>
      <div className="stat-value">{value}</div>
      {sub && <div className="small muted">{sub}</div>}
    </GlassCard>
  )
}
export function PageHeader({ title, subtitle, actions }) {
  return <header className="page-header fade-in"><div style={{ display: 'flex', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}><div style={{ flex: 1 }}><h1>{title}</h1>{subtitle && <p className="muted">{subtitle}</p>}</div><div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>{actions}</div></div></header>
}
export function Skeleton({ lines = 3 }) { return <div className="grid" role="status" aria-label="Loading">{Array.from({ length: lines }).map((_, i) => <div key={i} className="skeleton" />)}</div> }
export function EmptyState({ title = 'Nothing here yet', hint }) {
  return <div className="empty"><Inbox size={32} aria-hidden /><p style={{ fontWeight: 700, color: 'var(--text)' }}>{title}</p>{hint && <p className="small">{hint}</p>}</div>
}
export function ErrorState({ message, onRetry }) {
  return <div className="empty"><AlertTriangle size={32} aria-hidden /><p>{message || 'Something went wrong.'}</p>{onRetry && <button type="button" className="btn" style={{ marginTop: 10 }} onClick={onRetry}>Try again</button>}</div>
}
export function Spinner() { return <Loader2 className="spin" size={18} aria-hidden /> }
export function Modal({ title, onClose, wide = false, children }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return createPortal(<div className="modal-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
    <div className={`glass modal${wide ? ' modal-wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}><div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}><h2 style={{ margin: 0 }}>{title}</h2><button type="button" className="icon-btn" aria-label="Close dialog" onClick={onClose}>×</button></div><div style={{ marginTop: 14 }}>{children}</div></div>
  </div>, document.body)
}
export function ConfirmDialog({ title, message, confirmLabel = 'Delete', onConfirm, onCancel, busy }) {
  return <Modal title={title} onClose={onCancel}><p className="muted">{message}</p><div className="form-row"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="button" className="btn btn-danger" disabled={busy} onClick={onConfirm}>{busy ? 'Working…' : confirmLabel}</button></div></Modal>
}
export function BudgetBar({ spent, budget, threshold = 80 }) {
  if (budget == null) return <p className="small muted">No budget set for this month.</p>
  const pct = Number(spent) && Number(budget) ? Math.min(100, (Number(spent) / Number(budget)) * 100) : 0
  const over = Number(spent) > Number(budget)
  const warn = !over && pct >= Number(threshold || 80)
  return <div><div className={`progress ${over ? 'over' : warn ? 'warn' : ''}`} role="progressbar" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}><div style={{ width: `${pct}%` }} /></div>
    <div className="small muted" style={{ marginTop: 6 }}>{over ? <span className="badge badge-danger">Over budget</span> : warn ? <span className="badge badge-warn">Near limit</span> : <span className="badge badge-ok">{Math.round(pct)}% used</span>}</div></div>
}
export function CategoryIcon({ category, size = 20 }) {
  // Icon names are lucide names stored as strings; map common ones, fall back
  // to a neutral dot so an unknown name never crashes the UI.
  const color = category?.color || '#6366f1'
  const IconComp = category?.icon ? ICON_MAP[String(category.icon).toLowerCase()] : null
  if (IconComp) return <IconComp size={size} color={color} aria-hidden style={{ flexShrink: 0 }} />
  return <span aria-hidden style={{ width: size * 0.75, height: size * 0.75, borderRadius: '50%', background: color, display: 'inline-block', flexShrink: 0 }} />
}
