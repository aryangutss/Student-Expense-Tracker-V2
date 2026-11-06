import { useEffect, useState } from 'react'
import { Pause, Pencil, Play, Plus, Trash2, Zap } from 'lucide-react'
import { categoriesApi, parseErrorMessage, recurringApi } from '../services/api.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatDate, formatINR, todayInKolkata } from '../utils/format.js'
import { ConfirmDialog, EmptyState, ErrorState, GlassCard, Modal, PageHeader, Skeleton } from '../components/ui.jsx'

function RuleForm({ initial, categories, onSaved, onCancel }) {
  const { push } = useToast()
  const [v, setV] = useState({ category: initial?.category ?? '', description: initial?.description || '', amount: initial?.amount != null ? String(initial.amount) : '', frequency: initial?.frequency || 'monthly', start_date: initial?.start_date || todayInKolkata(), end_date: initial?.end_date || '', active: initial?.active ?? true })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))
  const submit = async (e) => { e.preventDefault(); setBusy(true); setError('')
    try { const body = { ...v, category: Number(v.category), end_date: v.end_date || null }; if (initial) await recurringApi.update(initial.id, body); else await recurringApi.create(body); push(initial ? 'Rule updated.' : 'Recurring rule created.'); onSaved() }
    catch (err) { const m = parseErrorMessage(err); setError(m); push(m, 'error') } finally { setBusy(false) } }
  return <form onSubmit={submit} className="form-grid">
    <div className="field"><label htmlFor="r-desc">Description</label><input id="r-desc" value={v.description} onChange={set('description')} required /></div>
    <div className="grid grid-2">
      <div className="field"><label htmlFor="r-cat">Category</label><select id="r-cat" value={v.category} onChange={set('category')} required><option value="">Select</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
      <div className="field"><label htmlFor="r-amt">Amount (₹)</label><input id="r-amt" inputMode="decimal" value={v.amount} onChange={set('amount')} required /></div>
      <div className="field"><label htmlFor="r-freq">Frequency</label><select id="r-freq" value={v.frequency} onChange={set('frequency')}><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="yearly">Yearly</option></select></div>
      <div className="field"><label htmlFor="r-start">Start date</label><input id="r-start" type="date" value={v.start_date} onChange={set('start_date')} required /></div>
      <div className="field"><label htmlFor="r-end">End date (optional)</label><input id="r-end" type="date" value={v.end_date} onChange={set('end_date')} /></div>
      <div className="field" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><input id="r-active" type="checkbox" checked={v.active} onChange={set('active')} /><label htmlFor="r-active">Active</label></div>
    </div>
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="form-row"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save rule'}</button></div>
  </form>
}

export default function Recurring() {
  const { push } = useToast()
  const [rules, setRules] = useState([]); const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const [modal, setModal] = useState(null); const [deleting, setDeleting] = useState(null); const [deleteBusy, setDeleteBusy] = useState(false); const [genBusy, setGenBusy] = useState(false)
  const load = async () => { setLoading(true); setError('')
    try { const [r, c] = await Promise.all([recurringApi.list({ page_size: 100 }), categoriesApi.list({ page_size: 100 })]); setRules(r.results); setCategories(c.results) }
    catch (e) { setError(parseErrorMessage(e)) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  const toggle = async (rule) => { try { await recurringApi.update(rule.id, { active: !rule.active }); push(rule.active ? 'Rule paused.' : 'Rule resumed.'); load() } catch (e) { push(parseErrorMessage(e), 'error') } }
  const generate = async () => { setGenBusy(true); try { const d = await recurringApi.generateDue(); const n = d?.created ?? d?.count ?? 0; push(n === 0 ? 'No recurring expenses were due.' : `${n} recurring expense${n === 1 ? '' : 's'} created.`); load() } catch (e) { push(parseErrorMessage(e), 'error') } finally { setGenBusy(false) } }
  const doDelete = async () => { setDeleteBusy(true); try { await recurringApi.remove(deleting.id); push('Rule deleted.'); setDeleting(null); load() } catch (e) { push(parseErrorMessage(e), 'error') } finally { setDeleteBusy(false) } }
  const catName = (id) => categories.find((c) => String(c.id) === String(id))?.name || '—'
  return <>
    <PageHeader title="Recurring" subtitle="Rules that generate expenses on schedule. Generate due now creates only the ones that are due." actions={<><button type="button" className="btn" disabled={genBusy} onClick={generate}><Zap size={16} /> {genBusy ? 'Generating…' : 'Generate due now'}</button><button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'create' })}><Plus size={16} /> New rule</button></>} />
    {loading ? <Skeleton lines={4} /> : error ? <ErrorState message={error} onRetry={load} /> : rules.length === 0 ? <GlassCard><EmptyState title="No recurring rules yet" hint="Create a rule for rent, subscriptions or allowances that repeat." /></GlassCard>
      : <div className="grid grid-2">{rules.map((r) => <GlassCard key={r.id}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><h2 style={{ margin: 0 }}>{r.description}</h2><span className={`badge ${r.active ? 'badge-ok' : 'badge-warn'}`}>{r.active ? 'Active' : 'Paused'}</span></div>
        <p className="muted small">{formatINR(r.amount)} · {r.frequency} · {catName(r.category)}</p>
        <p className="small muted">Next due: {r.next_due ? formatDate(r.next_due) : '—'}{r.last_generated_date ? ` · Last generated ${formatDate(r.last_generated_date)}` : ''}</p>
        <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
          <button type="button" className="btn btn-sm" onClick={() => toggle(r)}>{r.active ? <><Pause size={14} /> Pause</> : <><Play size={14} /> Resume</>}</button>
          <button type="button" className="btn btn-sm" onClick={() => setModal({ type: 'edit', rule: r })}><Pencil size={14} /> Edit</button>
          <button type="button" className="btn btn-sm btn-danger" onClick={() => setDeleting(r)}><Trash2 size={14} /> Delete</button>
        </div></GlassCard>)}</div>}
    {modal && <Modal title={modal.type === 'edit' ? 'Edit rule' : 'New recurring rule'} onClose={() => setModal(null)}><RuleForm initial={modal.rule} categories={categories} onSaved={() => { setModal(null); load() }} onCancel={() => setModal(null)} /></Modal>}
    {deleting && <ConfirmDialog title="Delete rule?" message={`Delete the recurring rule "${deleting.description}"? Past generated expenses are not affected.`} onConfirm={doDelete} onCancel={() => setDeleting(null)} busy={deleteBusy} />}
  </>
}
