import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { categoriesApi, expensesApi, parseErrorMessage } from '../services/api.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatINR, sumMoney } from '../utils/format.js'
import { CategoryIcon, ConfirmDialog, EmptyState, ErrorState, GlassCard, Modal, PageHeader, Skeleton } from '../components/ui.jsx'

const ICON_SUGGESTIONS = [
  'utensils', 'car', 'graduation-cap', 'home', 'shopping-bag', 'film',
  'heart-pulse', 'repeat', 'sparkles', 'package', 'book', 'gamepad-2',
  'heart', 'plane', 'coffee', 'wallet',
]
function CategoryForm({ initial, existing, onSaved, onCancel }) {
  const { push } = useToast()
  const [name, setName] = useState(initial?.name || ''); const [icon, setIcon] = useState(initial?.icon || 'wallet'); const [color, setColor] = useState(initial?.color || '#6366f1')
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async (e) => { e.preventDefault()
    if (existing.some((c) => c.name.toLowerCase() === name.trim().toLowerCase() && c.id !== initial?.id)) { setError(`A category named "${name.trim()}" already exists.`); return }
    setBusy(true); setError('')
    try { if (initial) await categoriesApi.update(initial.id, { name: name.trim(), icon, color }); else await categoriesApi.create({ name: name.trim(), icon, color }); push(initial ? 'Category updated.' : 'Category created.'); onSaved() }
    catch (err) { const m = parseErrorMessage(err); setError(m); push(m, 'error') } finally { setBusy(false) } }
  return <form onSubmit={submit} className="form-grid">
    <div className="field"><label htmlFor="c-name">Name</label><input id="c-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
    <div className="grid grid-2">
      <div className="field"><label htmlFor="c-icon">Icon (Lucide name)</label><select id="c-icon" value={icon} onChange={(e) => setIcon(e.target.value)}>{ICON_SUGGESTIONS.map((i) => <option key={i} value={i}>{i}</option>)}</select><p className="small muted">Stored as a Lucide icon name, per the API contract.</p></div>
      <div className="field"><label htmlFor="c-color">Colour</label><input id="c-color" type="color" value={color} onChange={(e) => setColor(e.target.value)} style={{ height: 42, padding: 4 }} /></div>
    </div>
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="form-row"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save category'}</button></div>
  </form>
}

export default function Categories() {
  const { push } = useToast()
  const [cats, setCats] = useState([]); const [stats, setStats] = useState({})
  const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const [modal, setModal] = useState(null); const [deleting, setDeleting] = useState(null); const [deleteBusy, setDeleteBusy] = useState(false)
  const load = async () => { setLoading(true); setError('')
    try {
      const r = await categoriesApi.list({ page_size: 100 }); setCats(r.results)
      const s = {}
      await Promise.all(r.results.map(async (c) => { try { const e = await expensesApi.list({ category: c.id, page_size: 1000 }); s[c.id] = { count: e.count, total: sumMoney(e.results.map((t) => t.amount)) } } catch { s[c.id] = { count: 0, total: '0.00' } } }))
      setStats(s)
    } catch (e) { setError(parseErrorMessage(e)) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  const doDelete = async () => { setDeleteBusy(true); try { await categoriesApi.remove(deleting.id); push('Category deleted.'); setDeleting(null); load() } catch (e) { push(parseErrorMessage(e), 'error') } finally { setDeleteBusy(false) } }
  return <>
    <PageHeader title="Categories" subtitle="Icons and colours are stored per category; deleting a category in use is refused by the API and the message is shown here." actions={<button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'create' })}><Plus size={16} /> New category</button>} />
    {loading ? <Skeleton lines={4} /> : error ? <ErrorState message={error} onRetry={load} /> : cats.length === 0 ? <GlassCard><EmptyState title="No categories yet" hint="Create your first category, then use it when adding expenses." /></GlassCard>
      : <div className="grid grid-2">{cats.map((c) => <GlassCard key={c.id}>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <span className="tx-icon" style={{ background: `${c.color}22`, border: `1px solid ${c.color}55` }}><CategoryIcon category={c} /></span>
          <div style={{ flex: 1 }}><h2 style={{ margin: 0 }}>{c.name}</h2><p className="small muted">Icon: {c.icon || '—'} · {stats[c.id]?.count ?? 0} transactions · {formatINR(stats[c.id]?.total ?? '0.00')}</p></div>
          <button type="button" className="btn btn-sm" aria-label={`Edit ${c.name}`} onClick={() => setModal({ type: 'edit', cat: c })}><Pencil size={14} /></button>
          <button type="button" className="btn btn-sm btn-danger" aria-label={`Delete ${c.name}`} onClick={() => setDeleting(c)}><Trash2 size={14} /></button>
        </div></GlassCard>)}</div>}
    {modal && <Modal title={modal.type === 'edit' ? 'Edit category' : 'New category'} onClose={() => setModal(null)}><CategoryForm initial={modal.cat} existing={cats} onSaved={() => { setModal(null); load() }} onCancel={() => setModal(null)} /></Modal>}
    {deleting && <ConfirmDialog title="Delete category?" message={`Delete "${deleting.name}"? If it is used by any expense, the API will refuse and the error will be shown — nothing will be deleted in that case.`} onConfirm={doDelete} onCancel={() => setDeleting(null)} busy={deleteBusy} />}
  </>
}
