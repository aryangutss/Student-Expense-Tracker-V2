import { useState } from 'react'
import { useToast } from '../context/ToastContext.jsx'
import { expensesApi, parseErrorMessage } from '../services/api.js'
import { todayInKolkata, validateExpenseForm } from '../utils/format.js'

const METHODS = ['cash', 'upi', 'card', 'bank', 'other']
// ExpenseForm: create or edit an expense. Submits via real POST/PATCH only;
// the submit button is disabled while submitting (duplicate guard).
export default function ExpenseForm({ initial = null, categories = [], onSaved, onCancel }) {
  const { push } = useToast()
  const [values, setValues] = useState(() => ({
    date: initial?.date || todayInKolkata(),
    category: initial?.category ?? '',
    description: initial?.description || '',
    merchant: initial?.merchant || '',
    amount: initial?.amount != null ? String(initial.amount) : '',
    payment_method: initial?.payment_method || 'upi',
    notes: initial?.notes || '',
    tags: initial?.tags || '',
  }))
  const [errors, setErrors] = useState({})
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setValues((v) => ({ ...v, [k]: e.target.value }))
  async function submit(e) {
    e.preventDefault()
    const errs = validateExpenseForm(values)
    setErrors(errs)
    if (Object.keys(errs).length) return
    setBusy(true)
    try {
      const body = { ...values, category: Number(values.category), amount: values.amount }
      if (initial) await expensesApi.update(initial.id, body)
      else await expensesApi.create(body)
      push(initial ? 'Expense updated.' : 'Expense added.')
      onSaved?.()
    } catch (err) {
      const msg = parseErrorMessage(err)
      push(msg, 'error')
      if (err.fieldErrors) setErrors(Object.fromEntries(Object.entries(err.fieldErrors).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)])))
    } finally { setBusy(false) }
  }
  return <form onSubmit={submit} className="form-grid" aria-label={initial ? 'Edit expense' : 'Add expense'}>
    <div className="grid grid-2">
      <div className="field"><label htmlFor="ef-date">Date</label><input id="ef-date" type="date" value={values.date} onChange={set('date')} />{errors.date && <div className="field-error">{errors.date}</div>}</div>
      <div className="field"><label htmlFor="ef-amount">Amount (₹)</label><input id="ef-amount" inputMode="decimal" placeholder="250.00" value={values.amount} onChange={set('amount')} />{errors.amount && <div className="field-error">{errors.amount}</div>}</div>
    </div>
    <div className="field"><label htmlFor="ef-desc">Description</label><input id="ef-desc" value={values.description} onChange={set('description')} placeholder="What was this for?" />{errors.description && <div className="field-error">{errors.description}</div>}</div>
    <div className="grid grid-2">
      <div className="field"><label htmlFor="ef-cat">Category</label><select id="ef-cat" value={values.category} onChange={set('category')}><option value="">Select a category</option>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>{errors.category && <div className="field-error">{errors.category}</div>}</div>
      <div className="field"><label htmlFor="ef-method">Payment method</label><select id="ef-method" value={values.payment_method} onChange={set('payment_method')}>{METHODS.map((m) => <option key={m} value={m}>{m.toUpperCase()}</option>)}</select></div>
    </div>
    <div className="grid grid-2">
      <div className="field"><label htmlFor="ef-merchant">Merchant (optional)</label><input id="ef-merchant" value={values.merchant} onChange={set('merchant')} /></div>
      <div className="field"><label htmlFor="ef-tags">Tags, comma-separated (optional)</label><input id="ef-tags" value={values.tags} onChange={set('tags')} placeholder="food, hostel" /></div>
    </div>
    <div className="field"><label htmlFor="ef-notes">Notes (optional)</label><textarea id="ef-notes" rows={2} value={values.notes} onChange={set('notes')} /></div>
    <div className="form-row">{onCancel && <button type="button" className="btn" onClick={onCancel}>Cancel</button>}<button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : initial ? 'Save changes' : 'Add expense'}</button></div>
  </form>
}
