import { useState } from 'react'
import { ChevronDown, Copy, Pencil, Trash2 } from 'lucide-react'
import { CategoryIcon } from './ui.jsx'
import { formatDate, formatINR } from '../utils/format.js'

export default function TransactionRow({ tx, onEdit, onDelete, onRepeat }) {
  const [open, setOpen] = useState(false)
  return <article>
    <div className="tx-row" onClick={() => setOpen((o) => !o)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === 'Enter') setOpen((o) => !o) }} aria-expanded={open}>
      <span className="tx-icon" style={{ background: `${tx.category_color || '#6366f1'}22`, border: `1px solid ${tx.category_color || '#6366f1'}55` }}><CategoryIcon category={{ color: tx.category_color, icon: tx.category_icon }} /></span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{tx.description}</div>
        <div className="small muted">{tx.category_name || 'Uncategorised'} · {formatDate(tx.date)}{tx.merchant ? ` · ${tx.merchant}` : ''}</div>
      </div>
      <span className="tx-amount">{formatINR(tx.amount)}</span>
      <span className="badge">{tx.payment_method || 'other'}</span>
      <ChevronDown size={16} aria-hidden style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform .15s' }} />
    </div>
    {open && <div className="glass" style={{ padding: 14, margin: '0 0 10px' }}>
      {tx.notes && <p className="small muted" style={{ marginBottom: 8 }}>Notes: {tx.notes}</p>}
      {tx.tags && <p className="small muted" style={{ marginBottom: 8 }}>Tags: {tx.tags}</p>}
      {tx.receipt && <p className="small" style={{ marginBottom: 8 }}><a href={tx.receipt} target="_blank" rel="noreferrer">View receipt</a></p>}
      {tx.recurring_rule && <p className="small muted" style={{ marginBottom: 8 }}>Recurring: {tx.recurring_rule}</p>}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onEdit?.(tx) }}><Pencil size={14} /> Edit</button>
        <button type="button" className="btn btn-sm" onClick={(e) => { e.stopPropagation(); onRepeat?.(tx) }}><Copy size={14} /> Repeat</button>
        <button type="button" className="btn btn-sm btn-danger" onClick={(e) => { e.stopPropagation(); onDelete?.(tx) }}><Trash2 size={14} /> Delete</button>
      </div>
    </div>}
  </article>
}
