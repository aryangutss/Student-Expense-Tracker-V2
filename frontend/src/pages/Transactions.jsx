import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Download, Plus, Upload } from 'lucide-react'
import { categoriesApi, expensesApi, parseErrorMessage } from '../services/api.js'
import { useToast } from '../context/ToastContext.jsx'
import { buildCSV, downloadCSV, formatDate, formatINR, normalizeMoneyString, sumMoney, todayInKolkata } from '../utils/format.js'
import { ConfirmDialog, EmptyState, ErrorState, Modal, PageHeader, Skeleton } from '../components/ui.jsx'
import ExpenseForm from '../components/ExpenseForm.jsx'
import ImportModal from '../components/ImportModal.jsx'
import TransactionRow from '../components/TransactionRow.jsx'

const METHODS = ['', 'cash', 'upi', 'card', 'bank', 'other']
export default function Transactions() {
  const { push } = useToast()
  const [params, setParams] = useSearchParams()
  const [items, setItems] = useState([]); const [count, setCount] = useState(0); const [next, setNext] = useState(null); const [prev, setPrev] = useState(null)
  const [categories, setCategories] = useState([])
  const [loading, setLoading] = useState(true); const [error, setError] = useState('')
  const [filters, setFilters] = useState(() => ({
    search: params.get('search') || '', category: params.get('category') || '', month: params.get('month') || '',
    date_from: params.get('date_from') || '', date_to: params.get('date_to') || '',
    payment_method: params.get('payment_method') || '', min_amount: '', max_amount: '', ordering: '-date',
  }))
  const [page, setPage] = useState(1)
  const [modal, setModal] = useState(null) // {type:'create'|'edit'|'repeat', tx?}
  const [importOpen, setImportOpen] = useState(() => params.get('import') === '1')
  const [deleting, setDeleting] = useState(null); const [deleteBusy, setDeleteBusy] = useState(false)

  const load = useCallback(async () => {
    setLoading(true); setError('')
    try {
      const p = { page, page_size: 20, ordering: filters.ordering }
      if (filters.search) p.search = filters.search
      if (filters.category) p.category = filters.category
      if (filters.month) p.month = filters.month
      if (filters.date_from) p.date_from = filters.date_from
      if (filters.date_to) p.date_to = filters.date_to
      if (filters.payment_method) p.payment_method = filters.payment_method
      if (filters.min_amount) p.min_amount = filters.min_amount
      if (filters.max_amount) p.max_amount = filters.max_amount
      const r = await expensesApi.list(p)
      setItems(r.results); setCount(r.count); setNext(r.next); setPrev(r.previous)
    } catch (e) { setError(parseErrorMessage(e)) } finally { setLoading(false) }
  }, [filters, page])
  useEffect(() => { load() }, [load])
  useEffect(() => {
    categoriesApi.list({ page_size: 100 }).then((r) => {
      setCategories(r.results)
      setFilters((f) => {
        if (!f.category || /^\d+$/.test(String(f.category))) return f
        const match = r.results.find((c) => c.name.toLowerCase() === String(f.category).toLowerCase())
        return match ? { ...f, category: String(match.id) } : f
      })
    }).catch(() => {})
  }, [])
  // Deep links from Dashboard (?edit=, ?repeat=) resolve via list or direct get.
  useEffect(() => {
    const editId = params.get('edit'); const repId = params.get('repeat')
    const targetId = editId || repId
    if (!targetId) return
    const type = editId ? 'edit' : 'repeat'
    const found = items.find((t) => String(t.id) === String(targetId))
    if (found) {
      setModal({ type, tx: found })
      setParams((p) => { p.delete('edit'); p.delete('repeat'); return p }, { replace: true })
    } else if (!loading) {
      expensesApi.get(targetId).then((tx) => {
        setModal({ type, tx })
      }).catch(() => {}).finally(() => {
        setParams((p) => { p.delete('edit'); p.delete('repeat'); return p }, { replace: true })
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, loading])

  const filteredTotal = sumMoney(items.map((t) => t.amount))
  const setF = (k) => (e) => { setFilters((f) => ({ ...f, [k]: e.target.value })); setPage(1) }
  const clearAll = () => { setFilters({ search: '', category: '', month: '', date_from: '', date_to: '', payment_method: '', min_amount: '', max_amount: '', ordering: '-date' }); setPage(1) }
  const exportCSV = async () => {
    try {
      const p = { page_size: 1000, ordering: filters.ordering }
      Object.entries(filters).forEach(([k, v]) => { if (k !== 'ordering' && v) p[k] = v })
      const r = await expensesApi.list(p)
      const csv = buildCSV([['Date', 'Description', 'Merchant', 'Category', 'Amount (INR)', 'Payment method', 'Tags', 'Notes'], ...r.results.map((t) => [t.date, t.description, t.merchant || '', t.category_name || '', normalizeMoneyString(t.amount) || '', t.payment_method || '', t.tags || '', t.notes || ''])])
      downloadCSV(`transactions-${todayInKolkata()}.csv`, csv); push(`Exported ${r.results.length} transactions as CSV.`)
    } catch (e) { push(parseErrorMessage(e), 'error') }
  }
  const doDelete = async () => {
    setDeleteBusy(true)
    try { await expensesApi.remove(deleting.id); push('Transaction deleted.'); setDeleting(null); load() } catch (e) { push(parseErrorMessage(e), 'error') } finally { setDeleteBusy(false) }
  }
  const repeatTx = (tx) => setModal({ type: 'repeat', tx })
  return <>
    <PageHeader
      title="Transactions"
      subtitle="Search, filter, sort, edit or import bank/UPI statements (PDF & CSV)."
      actions={
        <>
          <button type="button" className="btn" onClick={() => setImportOpen(true)}><Upload size={16} /> Import PDF / CSV</button>
          <button type="button" className="btn" onClick={exportCSV}><Download size={16} /> Export CSV</button>
          <button type="button" className="btn btn-primary" onClick={() => setModal({ type: 'create' })}><Plus size={16} /> Add expense</button>
        </>
      }
    />
    <section className="glass card">
      <div className="filters">
        <div className="field"><label htmlFor="f-search">Search</label><input id="f-search" placeholder="Description, merchant, category, id" value={filters.search} onChange={setF('search')} /></div>
        <div className="field"><label htmlFor="f-month">Month</label><input id="f-month" type="month" value={filters.month} onChange={setF('month')} /></div>
        <div className="field"><label htmlFor="f-cat">Category</label><select id="f-cat" value={filters.category} onChange={setF('category')}><option value="">All categories</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></div>
        <div className="field"><label htmlFor="f-method">Payment</label><select id="f-method" value={filters.payment_method} onChange={setF('payment_method')}><option value="">Any</option>{METHODS.filter(Boolean).map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</select></div>
        <div className="field"><label htmlFor="f-from">From</label><input id="f-from" type="date" value={filters.date_from} onChange={setF('date_from')} /></div>
        <div className="field"><label htmlFor="f-to">To</label><input id="f-to" type="date" value={filters.date_to} onChange={setF('date_to')} /></div>
        <div className="field"><label htmlFor="f-min">Min ₹</label><input id="f-min" inputMode="decimal" value={filters.min_amount} onChange={setF('min_amount')} /></div>
        <div className="field"><label htmlFor="f-max">Max ₹</label><input id="f-max" inputMode="decimal" value={filters.max_amount} onChange={setF('max_amount')} /></div>
        <div className="field"><label htmlFor="f-sort">Sort</label><select id="f-sort" value={filters.ordering} onChange={setF('ordering')}><option value="-date">Newest first</option><option value="date">Oldest first</option><option value="-amount">Amount high → low</option><option value="amount">Amount low → high</option></select></div>
        <button type="button" className="btn" onClick={clearAll}>Clear all filters</button>
      </div>
    </section>
    <section className="glass card" style={{ marginTop: 16 }}>
      <p className="small muted" style={{ marginBottom: 8 }}>{count} transaction{count === 1 ? '' : 's'} found · Page total: <strong style={{ color: 'var(--text)' }}>{formatINR(filteredTotal)}</strong> (page total; use Export CSV for the full filtered set)</p>
      {loading ? <Skeleton lines={5} /> : error ? <ErrorState message={error} onRetry={load} /> : items.length === 0 ? <EmptyState title="No transactions match" hint="Clear filters or add an expense." />
        : items.map((tx) => <TransactionRow key={tx.id} tx={tx} onEdit={(t) => setModal({ type: 'edit', tx: t })} onDelete={(t) => setDeleting(t)} onRepeat={repeatTx} />)}
      <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center' }}>
        <button type="button" className="btn btn-sm" disabled={!prev || page <= 1} onClick={() => setPage((p) => p - 1)}>Previous</button>
        <span className="small muted">Page {page}{count ? ` · ${count} total` : ''}</span>
        <button type="button" className="btn btn-sm" disabled={!next} onClick={() => setPage((p) => p + 1)}>Next</button>
      </div>
    </section>
    {modal && <Modal title={modal.type === 'edit' ? 'Edit expense' : modal.type === 'repeat' ? 'Repeat expense' : 'Add expense'} onClose={() => setModal(null)}>
      <ExpenseForm categories={categories} initial={modal.type === 'repeat' ? { ...modal.tx, id: undefined, date: todayInKolkata() } : modal.type === 'edit' ? modal.tx : null} onSaved={() => { setModal(null); load() }} onCancel={() => setModal(null)} />
    </Modal>}
    {importOpen && (
      <ImportModal
        categories={categories}
        existingExpenses={items}
        onImported={() => { setImportOpen(false); load() }}
        onClose={() => setImportOpen(false)}
      />
    )}
    {deleting && <ConfirmDialog title="Delete transaction?" message={`Delete "${deleting.description}" (${formatINR(deleting.amount)} on ${formatDate(deleting.date)})? This cannot be undone.`} onConfirm={doDelete} onCancel={() => setDeleting(null)} busy={deleteBusy} />}
  </>
}
