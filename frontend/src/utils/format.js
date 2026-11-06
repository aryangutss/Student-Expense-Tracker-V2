// Money, date and CSV helpers. Money is handled as decimal STRINGS / integer
// paise (cents) via BigInt-style string math — never JS float arithmetic for
// totals. Dates are date-only strings (YYYY-MM-DD) handled by parts, never
// parsed with `new Date(str)` (which would UTC-shift them in Asia/Kolkata).

export const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
export const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

export function parseDateParts(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr)
  if (!m) return null
  return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) }
}

export function formatDate(dateStr) {
  const p = parseDateParts(dateStr)
  if (!p) return dateStr || ''
  return `${String(p.day).padStart(2, '0')} ${MONTH_SHORT[p.month - 1]} ${p.year}`
}

export function todayInKolkata() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date())
  const get = (t) => parts.find((p) => p.type === t)?.value
  return `${get('year')}-${get('month')}-${get('day')}`
}

export function currentMonth() { return todayInKolkata().slice(0, 7) }
export function monthLabel(yyyyMm) {
  if (!yyyyMm) return ''
  const [y, m] = yyyyMm.split('-')
  const mi = Number(m) - 1
  return mi >= 0 && mi < 12 ? `${MONTH_NAMES[mi]} ${y}` : yyyyMm
}
export function monthToFirstDay(yyyyMm) { return yyyyMm ? `${yyyyMm}-01` : '' }
export function monthFromFirstDay(day) { return day ? day.slice(0, 7) : '' }
export function addMonths(yyyyMm, delta) {
  const [y, m] = yyyyMm.split('-').map(Number)
  const total = (y * 12 + (m - 1)) + delta
  const ny = Math.floor(total / 12)
  const nm = (total % 12) + 1
  return `${ny}-${String(nm).padStart(2, '0')}`
}
export function previousMonth(yyyyMm) { return addMonths(yyyyMm, -1) }

// ---- Money as strings / integer paise ----
export function normalizeMoneyString(value) {
  if (value === null || value === undefined || value === '') return null
  const s = String(value).trim().replace(/,/g, '').replace(/^₹\s*/, '')
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return null
  const neg = s.startsWith('-')
  const [int, frac = ''] = s.replace('-', '').split('.')
  const cleanedInt = int.replace(/^0+(?=\d)/, '') || '0'
  return `${neg ? '-' : ''}${cleanedInt}.${(frac + '00').slice(0, 2)}`
}
export function isValidMoney(value) { return normalizeMoneyString(value) !== null && Number(normalizeMoneyString(value)) >= 0 }
export function toPaise(value) {
  const n = normalizeMoneyString(value)
  if (n === null) return 0n
  const neg = n.startsWith('-')
  const [int, frac] = n.replace('-', '').split('.')
  const v = BigInt(int) * 100n + BigInt(frac)
  return neg ? -v : v
}
export function fromPaise(paise) {
  const neg = paise < 0n
  const abs = neg ? -paise : paise
  return `${neg ? '-' : ''}${(abs / 100n).toString()}.${(abs % 100n).toString().padStart(2, '0')}`
}
export function addMoney(a, b) { return fromPaise(toPaise(a) + toPaise(b)) }
export function sumMoney(values) { return fromPaise(values.reduce((acc, v) => acc + toPaise(v), 0n)) }
export function subtractMoney(a, b) { return fromPaise(toPaise(a) - toPaise(b)) }
export function moneyToNumber(value) { return Number(normalizeMoneyString(value) ?? '0.00') }

// INR display via Intl for the integer part only (grouping), fraction appended
// verbatim — so no float rounding ever touches the shown amount.
export function formatINR(value) {
  const n = normalizeMoneyString(value)
  if (n === null) return '₹0.00'
  const neg = n.startsWith('-')
  const [int, frac] = n.replace('-', '').split('.')
  const grouped = new Intl.NumberFormat('en-IN').format(Number(int))
  return `${neg ? '-' : ''}₹${grouped}.${frac}`
}
export function formatINRShort(value) { return formatINR(value) }
export function formatPct(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return '—'
  return `${Number(value).toFixed(1)}%`
}

// ---- CSV ----
export function buildCSV(rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return rows.map((r) => r.map(esc).join(',')).join('\r\n')
}
export function downloadTextFile(filename, text, mimeType = 'text/plain;charset=utf-8') {
  const blob = new Blob([text], { type: mimeType })
  try {
    if (typeof window !== 'undefined' && window.Capacitor?.isNativePlatform?.() && navigator?.canShare && typeof File !== 'undefined') {
      const file = new File([blob], filename, { type: mimeType.split(';')[0] })
      if (navigator.canShare({ files: [file] })) {
        navigator.share({ title: filename, files: [file] }).catch(() => {})
        return
      }
    }
  } catch { /* fall through to standard anchor download */ }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
export function downloadCSV(filename, csvText) {
  downloadTextFile(filename, csvText, 'text/csv;charset=utf-8')
}

// ---- Dashboard pure calculation (tested) ----
export function computeDashboardStats({ analytics, budgets }) {
  const totals = analytics?.totals ?? {}
  const spent = normalizeMoneyString(totals.spent) ?? '0.00'
  const income = normalizeMoneyString(totals.income) ?? '0.00'
  const overall = analytics?.budgets?.overall ?? null
  const budget = overall?.budgeted != null ? normalizeMoneyString(overall.budgeted) ?? '0.00' : null
  const remaining = budget !== null ? subtractMoney(budget, spent) : null
  const utilisation = budget !== null && toPaise(budget) > 0n
    ? Number((toPaise(spent) * 10000n) / toPaise(budget)) / 100 : null
  const prev = analytics?.previous_month ?? null
  return {
    spent, income,
    net: subtractMoney(income, spent),
    expenseCount: totals.expense_count ?? 0,
    incomeCount: totals.income_count ?? 0,
    dailyAverage: analytics?.daily_average != null ? normalizeMoneyString(analytics.daily_average) ?? '0.00' : '0.00',
    topCategory: analytics?.top_category ?? null,
    previousMonthSpent: prev?.spent != null ? normalizeMoneyString(prev.spent) : null,
    previousMonthDeltaPct: prev?.delta_percent ?? null,
    budget, remaining, utilisation,
    hasBudget: budget !== null,
    budgetCount: Array.isArray(budgets) ? budgets.length : 0,
  }
}

export function validateExpenseForm(values) {
  const errors = {}
  if (!values.date) errors.date = 'Date is required.'
  else if (!/^\d{4}-\d{2}-\d{2}$/.test(values.date)) errors.date = 'Use YYYY-MM-DD.'
  if (!values.category) errors.category = 'Choose a category.'
  if (!values.description?.trim()) errors.description = 'Description is required.'
  if (!isValidMoney(values.amount)) errors.amount = 'Enter a valid amount (e.g. 250.00).'
  if (values.payment_method && !['cash', 'upi', 'card', 'bank', 'other'].includes(values.payment_method)) errors.payment_method = 'Invalid payment method.'
  return errors
}
