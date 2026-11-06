import { useEffect, useState } from 'react'
import { Pencil, Plus, Trash2 } from 'lucide-react'
import { goalsApi, parseErrorMessage } from '../services/api.js'
import { useToast } from '../context/ToastContext.jsx'
import { formatDate, formatINR, fromPaise, subtractMoney, toPaise, todayInKolkata } from '../utils/format.js'
import { BudgetBar, ConfirmDialog, EmptyState, ErrorState, GlassCard, Modal, PageHeader, Skeleton } from '../components/ui.jsx'

function estimateCompletion(goal, contributions) {
  // Only when there are at least 2 dated contributions can a rate be derived.
  if (!contributions || contributions.length < 2) return null
  const sorted = [...contributions].sort((a, b) => a.date.localeCompare(b.date))
  const first = sorted[0].date; const last = sorted[sorted.length - 1].date
  const days = Math.max(1, Math.round((new Date(last) - new Date(first)) / 86400000))
  const total = contributions.reduce((acc, c) => acc + toPaise(c.amount), 0n)
  if (total <= 0n) return null
  const remaining = toPaise(goal.target_amount) - toPaise(goal.saved_amount ?? '0.00')
  if (remaining <= 0n) return 'Goal reached.'
  const perDay = total / BigInt(days)
  if (perDay <= 0n) return null
  const daysLeft = Number(remaining / perDay)
  const d = new Date(); d.setDate(d.getDate() + daysLeft)
  return `At your current pace (about ${formatINR(fromPaise(perDay))}/day), estimated completion in ~${daysLeft} days (${d.toISOString().slice(0, 10)}).`
}

function GoalForm({ initial, onSaved, onCancel }) {
  const { push } = useToast()
  const [v, setV] = useState({ name: initial?.name || '', target_amount: initial?.target_amount != null ? String(initial.target_amount) : '', target_date: initial?.target_date || '', description: initial?.description || '' })
  const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const set = (k) => (e) => setV((x) => ({ ...x, [k]: e.target.value }))
  const submit = async (e) => { e.preventDefault(); setBusy(true); setError('')
    try { const body = { ...v, target_date: v.target_date || null }; if (initial) await goalsApi.update(initial.id, body); else await goalsApi.create(body); push(initial ? 'Goal updated.' : 'Goal created.'); onSaved() }
    catch (err) { const m = parseErrorMessage(err); setError(m); push(m, 'error') } finally { setBusy(false) } }
  return <form onSubmit={submit} className="form-grid">
    <div className="field"><label htmlFor="g-name">Goal name</label><input id="g-name" value={v.name} onChange={set('name')} required /></div>
    <div className="grid grid-2">
      <div className="field"><label htmlFor="g-amt">Target amount (₹)</label><input id="g-amt" inputMode="decimal" value={v.target_amount} onChange={set('target_amount')} required /></div>
      <div className="field"><label htmlFor="g-date">Target date (optional)</label><input id="g-date" type="date" value={v.target_date} onChange={set('target_date')} /></div>
    </div>
    <div className="field"><label htmlFor="g-desc">Description (optional)</label><textarea id="g-desc" rows={2} value={v.description} onChange={set('description')} /></div>
    {error && <p role="alert" className="field-error">{error}</p>}
    <div className="form-row"><button type="button" className="btn" onClick={onCancel}>Cancel</button><button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save goal'}</button></div>
  </form>
}

export default function Goals() {
  const { push } = useToast()
  const [goals, setGoals] = useState([]); const [contribs, setContribs] = useState({})
  const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const [modal, setModal] = useState(null); const [deleting, setDeleting] = useState(null); const [deleteBusy, setDeleteBusy] = useState(false)
  const [contribForm, setContribForm] = useState(null) // goal
  const [cAmount, setCAmount] = useState(''); const [cDate, setCDate] = useState(todayInKolkata()); const [cNote, setCNote] = useState(''); const [cBusy, setCBusy] = useState(false)
  const load = async () => { setLoading(true); setError('')
    try {
      const r = await goalsApi.list({ page_size: 100 }); setGoals(r.results)
      const map = {}
      await Promise.all(r.results.map(async (g) => { try { map[g.id] = (await goalsApi.contributions.list(g.id)).results } catch { map[g.id] = [] } }))
      setContribs(map)
    } catch (e) { setError(parseErrorMessage(e)) } finally { setLoading(false) } }
  useEffect(() => { load() }, [])
  const addContribution = async (e) => { e.preventDefault(); setCBusy(true)
    try { await goalsApi.contributions.create(contribForm.id, { amount: cAmount, date: cDate, note: cNote }); push('Contribution added.'); setContribForm(null); setCAmount(''); setCNote(''); load() }
    catch (err) { push(parseErrorMessage(err), 'error') } finally { setCBusy(false) } }
  const deleteContribution = async (goalId, id) => { try { await goalsApi.contributions.remove(goalId, id); push('Contribution deleted.'); load() } catch (err) { push(parseErrorMessage(err), 'error') } }
  const doDelete = async () => { setDeleteBusy(true); try { await goalsApi.remove(deleting.id); push('Goal deleted.'); setDeleting(null); load() } catch (e) { push(parseErrorMessage(e), 'error') } finally { setDeleteBusy(false) } }
  return <>
    <PageHeader title="Goals" subtitle="Savings goals with contributions. Progress and current amounts are computed by the API." actions={<button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'create' })}><Plus size={16} /> New goal</button>} />
    {loading ? <Skeleton lines={4} /> : error ? <ErrorState message={error} onRetry={load} /> : goals.length === 0 ? <GlassCard><EmptyState title="No goals yet" hint="Create a goal — a new laptop, a trip, an emergency fund — and track contributions toward it." /></GlassCard>
      : <div className="grid grid-2">{goals.map((g) => {
        const current = g.saved_amount != null ? String(g.saved_amount) : '0.00'
        const remaining = subtractMoney(String(g.target_amount), current)
        const list = contribs[g.id] || []
        const est = estimateCompletion(g, list)
        return <GlassCard key={g.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}><h2 style={{ margin: 0 }}>{g.name}</h2><div style={{ display: 'flex', gap: 6 }}>
            <button type="button" className="btn btn-sm" aria-label={`Edit ${g.name}`} onClick={() => setModal({ type: 'edit', goal: g })}><Pencil size={14} /></button>
            <button type="button" className="btn btn-sm btn-danger" aria-label={`Delete ${g.name}`} onClick={() => setDeleting(g)}><Trash2 size={14} /></button></div></div>
          {g.description && <p className="muted small">{g.description}</p>}
          <p className="small muted">{formatINR(current)} of {formatINR(g.target_amount)} · {g.progress_percent ?? 0}% · Remaining {formatINR(remaining)}{g.target_date ? ` · Target ${formatDate(g.target_date)}` : ''}</p>
          <div style={{ marginTop: 10 }}><BudgetBar spent={current} budget={g.target_amount} /></div>
          <p className="small muted" style={{ marginTop: 8 }}>{est || 'Not enough contribution history yet to estimate a completion date — add at least two contributions on different dates.'}</p>
          <div style={{ marginTop: 12 }}>
            <button type="button" className="btn btn-sm btn-primary" onClick={() => { setContribForm(g); setCDate(todayInKolkata()) }}>Add contribution</button>
            {list.map((c) => <div key={c.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }} className="small"><span>{formatDate(c.date)} · {formatINR(c.amount)}{c.note ? ` · ${c.note}` : ''}</span><button type="button" className="btn btn-sm btn-danger" onClick={() => deleteContribution(g.id, c.id)}>Delete</button></div>)}
          </div>
        </GlassCard>
      })}</div>}
    {modal && <Modal title={modal.type === 'edit' ? 'Edit goal' : 'New goal'} onClose={() => setModal(null)}><GoalForm initial={modal.goal} onSaved={() => { setModal(null); load() }} onCancel={() => setModal(null)} /></Modal>}
    {contribForm && <Modal title={`Add contribution — ${contribForm.name}`} onClose={() => setContribForm(null)}>
      <form onSubmit={addContribution} className="form-grid">
        <div className="grid grid-2">
          <div className="field"><label htmlFor="cg-amt">Amount (₹)</label><input id="cg-amt" inputMode="decimal" value={cAmount} onChange={(e) => setCAmount(e.target.value)} required /></div>
          <div className="field"><label htmlFor="cg-date">Date</label><input id="cg-date" type="date" value={cDate} onChange={(e) => setCDate(e.target.value)} required /></div>
        </div>
        <div className="field"><label htmlFor="cg-note">Note (optional)</label><input id="cg-note" value={cNote} onChange={(e) => setCNote(e.target.value)} /></div>
        <div className="form-row"><button type="button" className="btn" onClick={() => setContribForm(null)}>Cancel</button><button type="submit" className="btn btn-primary" disabled={cBusy}>{cBusy ? 'Adding…' : 'Add contribution'}</button></div>
      </form></Modal>}
    {deleting && <ConfirmDialog title="Delete goal?" message={`Delete "${deleting.name}" and its contributions? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleting(null)} busy={deleteBusy} />}
  </>
}
