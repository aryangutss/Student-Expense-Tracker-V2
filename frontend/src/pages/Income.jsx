import { useCallback, useEffect, useState } from 'react'
import { Banknote, Briefcase, Download, GraduationCap, Pencil, Plus, Sparkles, Trash2 } from 'lucide-react'
import { incomesApi, parseErrorMessage } from '../services/api.js'
import { useToast } from '../context/ToastContext.jsx'
import {
  buildCSV, currentMonth, downloadCSV, formatDate, formatINR,
  isValidMoney, monthLabel, normalizeMoneyString, sumMoney, todayInKolkata,
} from '../utils/format.js'
import { ConfirmDialog, EmptyState, ErrorState, GlassCard, Modal, PageHeader, Skeleton, StatCard } from '../components/ui.jsx'

const SOURCES = [
  { value: 'allowance', label: 'Allowance', icon: Banknote, color: '#4ade80' },
  { value: 'scholarship', label: 'Scholarship', icon: GraduationCap, color: '#818cf8' },
  { value: 'part-time', label: 'Part-time work', icon: Briefcase, color: '#67e8f9' },
  { value: 'other', label: 'Other', icon: Sparkles, color: '#a78bfa' },
]

function sourceMeta(source) {
  return SOURCES.find((s) => s.value === source) || SOURCES[3]
}

function IncomeForm({ initial, onSaved, onCancel }) {
  const { push } = useToast()
  const [values, setValues] = useState(() => ({
    date: initial?.date || todayInKolkata(),
    source: initial?.source || 'allowance',
    description: initial?.description || '',
    amount: initial?.amount != null ? String(initial.amount) : '',
  }))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    const errs = {}
    if (!values.date || !/^\d{4}-\d{2}-\d{2}$/.test(values.date)) errs.date = 'Valid date is required.'
    if (!values.description.trim()) errs.description = 'Description is required.'
    if (!isValidMoney(values.amount) || Number(normalizeMoneyString(values.amount)) <= 0) {
      errs.amount = 'Enter an amount greater than zero (e.g. 5000.00).'
    }
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const body = {
        date: values.date,
        source: values.source,
        description: values.description.trim(),
        amount: values.amount,
      }
      if (initial) await incomesApi.update(initial.id, body)
      else await incomesApi.create(body)
      push(initial ? 'Income updated.' : 'Income recorded.')
      onSaved()
    } catch (err) {
      const msg = parseErrorMessage(err)
      push(msg, 'error')
      if (err.fieldErrors) {
        setErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)])))
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="form-grid" aria-label={initial ? 'Edit income' : 'Add income'}>
      <div className="grid grid-2">
        <div className="field">
          <label htmlFor="inc-date">Date</label>
          <input id="inc-date" type="date" value={values.date} onChange={set('date')} />
          {errors.date && <div className="field-error">{errors.date}</div>}
        </div>
        <div className="field">
          <label htmlFor="inc-amount">Amount (₹)</label>
          <input id="inc-amount" inputMode="decimal" placeholder="5000.00" value={values.amount} onChange={set('amount')} />
          {errors.amount && <div className="field-error">{errors.amount}</div>}
        </div>
      </div>
      <div className="field">
        <label htmlFor="inc-source">Source</label>
        <select id="inc-source" value={values.source} onChange={set('source')}>
          {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="inc-desc">Description</label>
        <input id="inc-desc" placeholder="Monthly hostel allowance, stipend, tutoring..." value={values.description} onChange={set('description')} />
        {errors.description && <div className="field-error">{errors.description}</div>}
      </div>
      <div className="form-row">
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Add income'}</button>
      </div>
    </form>
  )
}

export default function Income() {
  const { push } = useToast()
  const [items, setItems] = useState([])
  const [count, setCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState(() => ({
    search: '', month: currentMonth(), source: '', ordering: '-date',
  }))
  const [modal, setModal] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const p = { page_size: 200, ordering: filters.ordering }
      if (filters.search) p.search = filters.search
      if (filters.month) p.month = filters.month
      if (filters.source) p.source = filters.source
      const r = await incomesApi.list(p)
      setItems(r.results); setCount(r.count)
    } catch (e) {
      setError(parseErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }, [filters])

  useEffect(() => { load() }, [load])

  const totalIncome = sumMoney(items.map((i) => i.amount))
  const bySource = (src) => sumMoney(items.filter((i) => i.source === src).map((i) => i.amount))
  const setF = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value }))
  const clearFilters = () => setFilters({ search: '', month: '', source: '', ordering: '-date' })

  const exportCSV = () => {
    const csv = buildCSV([
      ['Date', 'Source', 'Description', 'Amount (INR)'],
      ...items.map((i) => [i.date, i.source, i.description, normalizeMoneyString(i.amount) || '']),
    ])
    downloadCSV(`income-${filters.month || todayInKolkata()}.csv`, csv)
    push(`Exported ${items.length} income records as CSV.`)
  }

  const doDelete = async () => {
    setDeleteBusy(true)
    try {
      await incomesApi.remove(deleting.id)
      push('Income entry deleted.')
      setDeleting(null)
      load()
    } catch (e) {
      push(parseErrorMessage(e), 'error')
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Income & Allowance"
        subtitle={`${filters.month ? monthLabel(filters.month) : 'All months'} · Track allowances, scholarships and part-time earnings separately from expenses.`}
        actions={
          <>
            <button type="button" className="btn" onClick={exportCSV}><Download size={16} /> Export CSV</button>
            <button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'create' })}><Plus size={16} /> Add income</button>
          </>
        }
      />
      <div className="grid grid-4" style={{ marginBottom: 16 }}>
        <StatCard icon={<Banknote size={16} />} label="Total income shown" value={formatINR(totalIncome)} sub={`${count} record${count === 1 ? '' : 's'}`} />
        <StatCard icon={<Banknote size={16} />} label="Allowance" value={formatINR(bySource('allowance'))} sub="Family / pocket money" />
        <StatCard icon={<GraduationCap size={16} />} label="Scholarship" value={formatINR(bySource('scholarship'))} sub="Stipends & grants" />
        <StatCard icon={<Briefcase size={16} />} label="Part-time & Other" value={formatINR(sumMoney([bySource('part-time'), bySource('other')]))} sub="Work, freelance & other" />
      </div>
      <section className="glass card">
        <div className="filters">
          <div className="field"><label htmlFor="inc-f-search">Search</label><input id="inc-f-search" placeholder="Description or source" value={filters.search} onChange={setF('search')} /></div>
          <div className="field"><label htmlFor="inc-f-month">Month</label><input id="inc-f-month" type="month" value={filters.month} onChange={setF('month')} /></div>
          <div className="field">
            <label htmlFor="inc-f-source">Source</label>
            <select id="inc-f-source" value={filters.source} onChange={setF('source')}>
              <option value="">All sources</option>
              {SOURCES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="inc-f-sort">Sort</label>
            <select id="inc-f-sort" value={filters.ordering} onChange={setF('ordering')}>
              <option value="-date">Newest first</option>
              <option value="date">Oldest first</option>
              <option value="-amount">Amount high → low</option>
              <option value="amount">Amount low → high</option>
            </select>
          </div>
          <button type="button" className="btn" onClick={clearFilters}>Show all</button>
        </div>
      </section>
      <GlassCard className="" style={{ marginTop: 16 }}>
        {loading ? <Skeleton lines={4} /> : error ? <ErrorState message={error} onRetry={load} /> : items.length === 0 ? (
          <EmptyState title="No income recorded for this filter" hint="Add your monthly allowance, scholarship or part-time income to see your net cash flow on the Dashboard and Analytics." />
        ) : (
          items.map((inc) => {
            const meta = sourceMeta(inc.source)
            const Icon = meta.icon
            return (
              <div key={inc.id} className="tx-row" style={{ cursor: 'default' }}>
                <span className="tx-icon" style={{ background: `${meta.color}22`, border: `1px solid ${meta.color}55` }}>
                  <Icon size={20} color={meta.color} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{inc.description}</div>
                  <div className="small muted">{meta.label} · {formatDate(inc.date)}</div>
                </div>
                <span className="tx-amount" style={{ color: 'var(--green)' }}>+{formatINR(inc.amount)}</span>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-sm" aria-label={`Edit ${inc.description}`} onClick={() => setModal({ type: 'edit', inc })}><Pencil size={14} /></button>
                  <button type="button" className="btn btn-sm btn-danger" aria-label={`Delete ${inc.description}`} onClick={() => setDeleting(inc)}><Trash2 size={14} /></button>
                </div>
              </div>
            )
          })
        )}
      </GlassCard>
      {modal && (
        <Modal title={modal.type === 'edit' ? 'Edit income' : 'Add income'} onClose={() => setModal(null)}>
          <IncomeForm initial={modal.inc} onSaved={() => { setModal(null); load() }} onCancel={() => setModal(null)} />
        </Modal>
      )}
      {deleting && (
        <ConfirmDialog
          title="Delete income?"
          message={`Delete "${deleting.description}" (${formatINR(deleting.amount)} on ${formatDate(deleting.date)})?`}
          onConfirm={doDelete}
          onCancel={() => setDeleting(null)}
          busy={deleteBusy}
        />
      )}
    </>
  )
}
