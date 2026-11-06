import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { analyticsApi, budgetsApi, categoriesApi, parseErrorMessage } from '../services/api.js'
import { useToast } from '../context/ToastContext.jsx'
import { currentMonth, formatINR, monthLabel, monthToFirstDay, subtractMoney } from '../utils/format.js'
import { BudgetBar, ConfirmDialog, EmptyState, ErrorState, GlassCard, Modal, PageHeader, Skeleton } from '../components/ui.jsx'

function BudgetForm({ initial, categories, month, onSaved, onCancel }) {
  const { push } = useToast()
  const [category, setCategory] = useState(initial?.category ?? '')
  const [amount, setAmount] = useState(initial?.amount != null ? String(initial.amount) : '')
  const [threshold, setThreshold] = useState(initial?.alert_threshold ?? 80)
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async (e) => { e.preventDefault(); setBusy(true); setError('')
    try {
      const body = { month: monthToFirstDay(month), category: category === '' ? null : Number(category), amount, alert_threshold: Number(threshold) }
      if (initial) await budgetsApi.update(initial.id, body); else await budgetsApi.create(body)
      push(initial ? 'Budget updated.' : 'Budget created.'); onSaved()
    } catch (err) { const m = parseErrorMessage(err); setError(m); push(m, 'error') } finally { setBusy(false) } }
  return <form onSubmit={submit} className="form-grid">
    <div className="field"><label htmlFor="b-cat">Category (leave blank for overall budget)</label><select id="b-cat" value={category} onChange={(e) => setCategory(e.target.value)}><option value="">Overall (all categories)</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
    <div className="grid grid-2">
      <div className="field"><label htmlFor="b-amt">Budget amount (₹)</label><input id="b-amt" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
      <div className="field"><label htmlFor="b-thr">Alert threshold (%)</label><input id="b-thr" type="number" min="1" max="100" value={threshold} onChange={(e) => setThreshold(e.target.value)} /></div>
    </div>
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="form-row"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save budget'}</button></div>
  </form>
}

export default function Budgets() {
  const { push } = useToast()
  const [month, setMonth] = useState(currentMonth())
  const [budgets, setBudgets] = useState([]); const [actual, setActual] = useState(null)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const [modal, setModal] = useState(null); const [deleting, setDeleting] = useState(null); const [deleteBusy, setDeleteBusy] = useState(false)
  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const [b, a, c] = await Promise.all([budgetsApi.list({ month }), analyticsApi.get({ month }), categoriesApi.list({ page_size: 100 })])
      setBudgets(b.results); setActual(a?.budgets ?? null); setCategories(c.results)
    } catch (e) { setError(parseErrorMessage(e)) } finally { setLoading(false) }
  }, [month])
  useEffect(() => { load() }, [load])
  const actualFor = (b) => {
    if (!actual) return null
    if (b.category == null) return actual.overall
    return (actual.categories || []).find((x) => String(x.category_id) === String(b.category)) || null
  }
  const doDelete = async () => { setDeleteBusy(true); try { await budgetsApi.remove(deleting.id); push('Budget deleted.'); setDeleting(null); load() } catch (e) { push(parseErrorMessage(e), 'error') } finally { setDeleteBusy(false) } }
  return <>
    <PageHeader title="Budgets" subtitle={`Budgets for ${monthLabel(month)} — progress is measured against real spending from Analytics.`} actions={<button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'create' })}><Plus size={16} /> New budget</button>} />
    <div className="field" style={{ maxWidth: 220, marginBottom: 16 }}><label htmlFor="b-month">Month</label><input id="b-month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
    {loading ? <Skeleton lines={4} /> : error ? <ErrorState message={error} onRetry={load} /> : budgets.length === 0 ? <GlassCard><EmptyState title={`No budget set for ${monthLabel(month)}`} hint="Create an overall budget or a per-category budget — months without a budget never crash the dashboard, they just show this state." /><div style={{ textAlign: 'center', marginTop: 8 }}><button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'create' })}>Set a budget</button></div></GlassCard>
      : <div className="grid grid-2">{budgets.map((b) => {
        const a = actualFor(b)
        const spent = a?.spent ?? '0.00'; const remaining = subtractMoney(String(b.amount), spent)
        return <GlassCard key={b.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><h2>{b.category_name || 'Overall budget'}</h2><div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-sm" aria-label={`Edit ${b.category_name || 'overall'} budget`} onClick={() => setModal({ type: 'edit', budget: b })}><Pencil size={14} /></button>
            <button type="button" className="btn btn-sm btn-danger" aria-label="Delete budget" onClick={() => setDeleting(b)}><Trash2 size={14} /></button></div></div>
          <p className="muted small">Budget {formatINR(b.amount)} · Spent {formatINR(spent)} · Remaining {formatINR(remaining)} · Alert at {b.alert_threshold ?? 80}%</p>
          <div style={{ marginTop: 12 }}><BudgetBar spent={spent} budget={b.amount} threshold={b.alert_threshold} /></div>
          {!a && <p className="small muted" style={{ marginTop: 8 }}>No spending recorded for this scope yet.</p>}
        </GlassCard>
      })}</div>}
    <p className="small muted" style={{ marginTop: 14 }}>Budget history: change the month picker above to review earlier months. <Link to="/analytics">See budget vs actual in Analytics</Link>.</p>
    {modal && <Modal title={modal.type === 'edit' ? 'Edit budget' : 'New budget'} onClose={() => setModal(null)}><BudgetForm initial={modal.budget} categories={categories} month={month} onSaved={() => { setModal(null); load() }} onCancel={() => setModal(null)} /></Modal>}
    {deleting && <ConfirmDialog title="Delete budget?" message={`Delete the ${deleting.category_name || 'overall'} budget of ${formatINR(deleting.amount)}?`} onConfirm={doDelete} onCancel={() => setDeleting(null)} busy={deleteBusy} />}
  </>
}
