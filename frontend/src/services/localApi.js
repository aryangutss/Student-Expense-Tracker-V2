// On-device implementation of the same API surface as services/api.js.
// Used when the data mode is 'local' (the default inside the Android app).
// Records live only in this browser/WebView's localStorage, under one key,
// and are never sent anywhere. Money is stored as decimal strings and all
// arithmetic uses the paise (BigInt) helpers, exactly like the server side
// uses Decimal. Validation mirrors the Django serializers: positive amounts,
// required fields, case-insensitive unique category names, and a category
// that is in use cannot be deleted.
import {
  fromPaise, normalizeMoneyString, sumMoney, toPaise, todayInKolkata,
} from '../utils/format.js'
import { ApiError } from './errors.js'
import { clearToken, setToken } from './token.js'

const STORE_KEY = 'expense_tracker_local_v1'

export const LOCAL_DEFAULT_CATEGORIES = [
  ['Food', 'utensils', '#F97316'],
  ['Transport', 'car', '#3B82F6'],
  ['Education', 'graduation-cap', '#8B5CF6'],
  ['Accommodation', 'home', '#0EA5E9'],
  ['Shopping', 'shopping-bag', '#EC4899'],
  ['Entertainment', 'film', '#F43F5E'],
  ['Health', 'heart-pulse', '#22C55E'],
  ['Subscriptions', 'repeat', '#6366F1'],
  ['Personal Care', 'sparkles', '#14B8A6'],
  ['Other', 'package', '#64748B'],
]

function emptyStore() {
  return {
    user: null, seq: { category: 0, expense: 0, budget: 0, income: 0, recurring: 0, goal: 0, contribution: 0 },
    categories: [], expenses: [], budgets: [], incomes: [], recurring: [], goals: [], contributions: [],
  }
}
function load() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || emptyStore() } catch { return emptyStore() }
}
function save(store) { localStorage.setItem(STORE_KEY, JSON.stringify(store)) }
function nextId(store, kind) { store.seq[kind] += 1; return store.seq[kind] }
function fieldError(field, message) { throw new ApiError(400, { [field]: [message] }) }
function requireUser(store) {
  if (!store.user) throw new ApiError(401, { detail: 'Authentication credentials were not provided.' })
  return store.user
}
function isValidDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false
  const [y, m, d] = s.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}
function moneyField(value, field) {
  const n = normalizeMoneyString(value)
  if (n === null || toPaise(n) <= 0n) fieldError(field, 'Enter an amount greater than zero.')
  return n
}
function paginate(items, params = {}) {
  const page = Math.max(1, parseInt(params.page, 10) || 1)
  const pageSize = Math.min(1000, Math.max(1, parseInt(params.page_size, 10) || 20))
  const count = items.length
  const start = (page - 1) * pageSize
  return {
    results: items.slice(start, start + pageSize), count,
    next: start + pageSize < count ? page + 1 : null,
    previous: page > 1 ? page - 1 : null,
  }
}
function sortItems(items, ordering, comparators) {
  if (!ordering) return items
  const desc = ordering.startsWith('-')
  const key = desc ? ordering.slice(1) : ordering
  const cmp = comparators[key]
  if (!cmp) return items
  return [...items].sort((a, b) => (desc ? -cmp(a, b) : cmp(a, b)))
}
function catOf(store, id) { return store.categories.find((c) => c.id === Number(id)) || null }
function resolveCategory(store, value) {
  if (value === null || value === undefined || value === '') return null
  if (typeof value === 'number' || /^\d+$/.test(String(value))) return catOf(store, value)
  return store.categories.find((c) => c.name.toLowerCase() === String(value).toLowerCase()) || null
}
function withCategory(store, row) {
  const c = row.category != null ? catOf(store, row.category) : null
  return { ...row, category_name: c ? c.name : null, category_color: c ? c.color : null, category_icon: c ? c.icon : null }
}
function refreshExpenseCategories(store) {
  store.expenses = store.expenses.map((e) => {
    const c = e.category != null ? catOf(store, e.category) : null
    return { ...e, category_name: c ? c.name : null, category_color: c ? c.color : null, category_icon: c ? c.icon : null }
  })
}
function seedCategories(store) {
  LOCAL_DEFAULT_CATEGORIES.forEach(([name, icon, color]) => {
    store.categories.push({ id: nextId(store, 'category'), name, icon, color })
  })
}
async function hashPassword(password) {
  try {
    if (globalThis.crypto?.subtle) {
      const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(password))
      return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
    }
  } catch { /* fall through to the simple hash below */ }
  let h = 0x811c9dc5
  for (const ch of password) { h ^= ch.charCodeAt(0); h = Math.imul(h, 0x01000193) }
  return `fnv${(h >>> 0).toString(16)}`
}
const publicUser = (u) => ({ id: u.id, username: u.username, email: u.email || '' })

export const localAuthApi = {
  register: async (body) => {
    const store = load()
    const username = String(body?.username || '').trim()
    const password = String(body?.password || '')
    if (!username) fieldError('username', 'This field is required.')
    if (password.length < 8) fieldError('password', 'Password must be at least 8 characters.')
    if (store.user) {
      fieldError('username', 'An account already exists on this device. Log in instead.')
    }
    store.user = { id: 1, username, email: body?.email || '', passHash: await hashPassword(password) }
    seedCategories(store)
    save(store)
    setToken('local')
    return { user: publicUser(store.user), token: 'local' }
  },
  login: async (body) => {
    const store = load()
    const username = String(body?.username || '').trim()
    const password = String(body?.password || '')
    if (!store.user || store.user.username.toLowerCase() !== username.toLowerCase()
      || store.user.passHash !== await hashPassword(password)) {
      throw new ApiError(400, { non_field_errors: ['Invalid username or password.'] })
    }
    setToken('local')
    return { user: publicUser(store.user), token: 'local' }
  },
  logout: async () => { clearToken() },
  me: async () => {
    const store = load()
    requireUser(store)
    return publicUser(store.user)
  },
}

function validateExpenseBody(store, body, partial) {
  const out = {}
  if (!partial || body.date !== undefined) {
    if (!isValidDate(body.date)) fieldError('date', 'Enter a valid date.')
    out.date = body.date
  }
  if (!partial || body.description !== undefined) {
    if (!String(body.description || '').trim()) fieldError('description', 'This field is required.')
    out.description = String(body.description).trim()
  }
  if (!partial || body.amount !== undefined) out.amount = moneyField(body.amount, 'amount')
  if (!partial || body.category !== undefined) {
    const c = resolveCategory(store, body.category)
    if (!c && body.category !== null && body.category !== '' && body.category !== undefined) {
      fieldError('category', 'Unknown category.')
    }
    out.category = c ? c.id : null
  }
  if (body.merchant !== undefined) out.merchant = String(body.merchant || '')
  if (body.payment_method !== undefined) out.payment_method = body.payment_method || 'other'
  if (body.notes !== undefined) out.notes = String(body.notes || '')
  if (body.tags !== undefined) out.tags = String(body.tags || '')
  return out
}

export const localExpensesApi = {
  list: async (params = {}) => {
    const store = load(); requireUser(store)
    let items = store.expenses.map((e) => withCategory(store, e))
    if (params.search) {
      const q = String(params.search).toLowerCase()
      items = items.filter((e) => String(e.id) === q || e.description.toLowerCase().includes(q)
        || (e.merchant || '').toLowerCase().includes(q) || (e.category_name || '').toLowerCase().includes(q))
    }
    if (params.category !== undefined && params.category !== '') {
      const c = resolveCategory(store, params.category)
      items = items.filter((e) => (c ? e.category === c.id : String(e.category_name || '').toLowerCase() === String(params.category).toLowerCase()))
    }
    if (params.month) items = items.filter((e) => e.date.startsWith(params.month))
    if (params.date_from) items = items.filter((e) => e.date >= params.date_from)
    if (params.date_to) items = items.filter((e) => e.date <= params.date_to)
    if (params.payment_method) items = items.filter((e) => e.payment_method === params.payment_method)
    if (params.min_amount) items = items.filter((e) => toPaise(e.amount) >= toPaise(normalizeMoneyString(params.min_amount) || '0'))
    if (params.max_amount) items = items.filter((e) => toPaise(e.amount) <= toPaise(normalizeMoneyString(params.max_amount) || '0'))
    items = sortItems(items, params.ordering || '-date', {
      date: (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id),
      amount: (a, b) => (toPaise(a.amount) < toPaise(b.amount) ? -1 : toPaise(a.amount) > toPaise(b.amount) ? 1 : a.id - b.id),
      category: (a, b) => (String(a.category_name || '') < String(b.category_name || '') ? -1 : 1),
    })
    return paginate(items, params)
  },
  get: async (id) => {
    const store = load(); requireUser(store)
    const e = store.expenses.find((x) => x.id === Number(id))
    if (!e) throw new ApiError(404, { detail: 'Not found.' })
    return withCategory(store, e)
  },
  create: async (body) => {
    const store = load(); requireUser(store)
    const v = validateExpenseBody(store, body, false)
    const now = new Date().toISOString()
    const e = {
      id: nextId(store, 'expense'), ...v, merchant: v.merchant || '', payment_method: v.payment_method || 'other',
      notes: v.notes || '', tags: v.tags || '', receipt: null, recurring_rule: body?.recurring_rule ?? null,
      recurring_date: body?.recurring_date ?? null, created_at: now, updated_at: now,
    }
    store.expenses.push(e); refreshExpenseCategories(store); save(store)
    return withCategory(store, e)
  },
  update: async (id, body) => {
    const store = load(); requireUser(store)
    const e = store.expenses.find((x) => x.id === Number(id))
    if (!e) throw new ApiError(404, { detail: 'Not found.' })
    Object.assign(e, validateExpenseBody(store, body, true), { updated_at: new Date().toISOString() })
    refreshExpenseCategories(store); save(store)
    return withCategory(store, e)
  },
  remove: async (id) => {
    const store = load(); requireUser(store)
    const before = store.expenses.length
    store.expenses = store.expenses.filter((x) => x.id !== Number(id))
    if (store.expenses.length === before) throw new ApiError(404, { detail: 'Not found.' })
    save(store)
  },
  bulkImport: async ({ expenses = [], incomes = [] } = {}) => {
    const store = load(); requireUser(store)
    let createdExpenses = 0
    let createdIncomes = 0
    const errors = []
    const now = new Date().toISOString()
    expenses.forEach((item, idx) => {
      try {
        const v = validateExpenseBody(store, item, false)
        store.expenses.push({
          id: nextId(store, 'expense'), ...v, merchant: v.merchant || '', payment_method: v.payment_method || 'other',
          notes: v.notes || '', tags: v.tags || '', receipt: null, recurring_rule: null, recurring_date: null,
          created_at: now, updated_at: now,
        })
        createdExpenses += 1
      } catch (err) {
        errors.push({ index: idx, type: 'expense', errors: err.data || err.message })
      }
    })
    incomes.forEach((item, idx) => {
      try {
        if (!isValidDate(item?.date)) fieldError('date', 'Enter a valid date.')
        if (!String(item?.description || '').trim()) fieldError('description', 'This field is required.')
        store.incomes.push({
          id: nextId(store, 'income'), date: item.date, source: item.source || 'other',
          description: String(item.description).trim(), amount: moneyField(item.amount, 'amount'),
        })
        createdIncomes += 1
      } catch (err) {
        errors.push({ index: idx, type: 'income', errors: err.data || err.message })
      }
    })
    refreshExpenseCategories(store)
    save(store)
    return { created_expenses: createdExpenses, created_incomes: createdIncomes, errors }
  },
}

export const localCategoriesApi = {
  list: async (params = {}) => {
    const store = load(); requireUser(store)
    return paginate([...store.categories], params)
  },
  get: async (id) => {
    const store = load(); requireUser(store)
    const c = catOf(store, id)
    if (!c) throw new ApiError(404, { detail: 'Not found.' })
    return c
  },
  create: async (body) => {
    const store = load(); requireUser(store)
    const name = String(body?.name || '').trim()
    if (!name) fieldError('name', 'This field is required.')
    if (store.categories.some((c) => c.name.toLowerCase() === name.toLowerCase())) {
      fieldError('name', 'Category with this name already exists.')
    }
    const c = { id: nextId(store, 'category'), name, icon: body?.icon || 'package', color: body?.color || '#64748B' }
    store.categories.push(c); save(store)
    return c
  },
  update: async (id, body) => {
    const store = load(); requireUser(store)
    const c = catOf(store, id)
    if (!c) throw new ApiError(404, { detail: 'Not found.' })
    if (body.name !== undefined) {
      const name = String(body.name).trim()
      if (!name) fieldError('name', 'This field is required.')
      if (store.categories.some((x) => x.id !== c.id && x.name.toLowerCase() === name.toLowerCase())) {
        fieldError('name', 'Category with this name already exists.')
      }
      c.name = name
    }
    if (body.icon !== undefined) c.icon = body.icon
    if (body.color !== undefined) c.color = body.color
    refreshExpenseCategories(store); save(store)
    return c
  },
  remove: async (id) => {
    const store = load(); requireUser(store)
    const used = store.expenses.filter((e) => e.category === Number(id)).length
    if (used > 0) throw new ApiError(400, { detail: `Category is used by ${used} expense(s). Reassign or delete those expenses first.` })
    const before = store.categories.length
    store.categories = store.categories.filter((c) => c.id !== Number(id))
    if (store.categories.length === before) throw new ApiError(404, { detail: 'Not found.' })
    save(store)
  },
}

function budgetView(store, b) {
  return { ...b, category_name: b.category != null ? (catOf(store, b.category)?.name ?? null) : null }
}
export const localBudgetsApi = {
  list: async (params = {}) => {
    const store = load(); requireUser(store)
    let items = store.budgets.map((b) => budgetView(store, b))
    if (params.month) items = items.filter((b) => String(b.month).startsWith(params.month))
    return paginate(items, params)
  },
  get: async (id) => {
    const store = load(); requireUser(store)
    const b = store.budgets.find((x) => x.id === Number(id))
    if (!b) throw new ApiError(404, { detail: 'Not found.' })
    return budgetView(store, b)
  },
  create: async (body) => {
    const store = load(); requireUser(store)
    const month = String(body?.month || '')
    const monthFirst = /^\d{4}-\d{2}/.test(month) ? `${month.slice(0, 7)}-01` : ''
    if (!isValidDate(monthFirst)) fieldError('month', 'Enter a valid month.')
    const amount = moneyField(body?.amount, 'amount')
    const category = body?.category === '' || body?.category === null || body?.category === undefined
      ? null : (resolveCategory(store, body.category)?.id ?? null)
    if (body?.category !== '' && body?.category !== null && body?.category !== undefined && category === null) {
      fieldError('category', 'Unknown category.')
    }
    const dup = store.budgets.some((b) => b.month === monthFirst
      && ((b.category === null && category === null) || b.category === category))
    if (dup) fieldError('category', 'A budget for this month and category already exists.')
    const b = {
      id: nextId(store, 'budget'), month: monthFirst, category, amount,
      alert_threshold: body?.alert_threshold != null ? Number(body.alert_threshold) : 80,
    }
    store.budgets.push(b); save(store)
    return budgetView(store, b)
  },
  update: async (id, body) => {
    const store = load(); requireUser(store)
    const b = store.budgets.find((x) => x.id === Number(id))
    if (!b) throw new ApiError(404, { detail: 'Not found.' })
    if (body.amount !== undefined) b.amount = moneyField(body.amount, 'amount')
    if (body.alert_threshold !== undefined) b.alert_threshold = Number(body.alert_threshold)
    if (body.month !== undefined) {
      const m = `${String(body.month).slice(0, 7)}-01`
      if (!isValidDate(m)) fieldError('month', 'Enter a valid month.')
      b.month = m
    }
    if (body.category !== undefined) {
      b.category = body.category === '' || body.category === null ? null : (resolveCategory(store, body.category)?.id ?? null)
    }
    save(store)
    return budgetView(store, b)
  },
  remove: async (id) => {
    const store = load(); requireUser(store)
    const before = store.budgets.length
    store.budgets = store.budgets.filter((b) => b.id !== Number(id))
    if (store.budgets.length === before) throw new ApiError(404, { detail: 'Not found.' })
    save(store)
  },
}

export const localIncomesApi = {
  list: async (params = {}) => {
    const store = load(); requireUser(store)
    let items = [...store.incomes]
    if (params.month) items = items.filter((i) => i.date.startsWith(params.month))
    if (params.source) items = items.filter((i) => i.source === params.source)
    if (params.search) {
      const q = String(params.search).toLowerCase()
      items = items.filter((i) => i.description.toLowerCase().includes(q) || (i.source || '').toLowerCase().includes(q))
    }
    items = sortItems(items, params.ordering || '-date', {
      date: (a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.id - b.id),
      amount: (a, b) => (toPaise(a.amount) < toPaise(b.amount) ? -1 : toPaise(a.amount) > toPaise(b.amount) ? 1 : a.id - b.id),
    })
    return paginate(items, params)
  },
  get: async (id) => {
    const store = load(); requireUser(store)
    const i = store.incomes.find((x) => x.id === Number(id))
    if (!i) throw new ApiError(404, { detail: 'Not found.' })
    return i
  },
  create: async (body) => {
    const store = load(); requireUser(store)
    if (!isValidDate(body?.date)) fieldError('date', 'Enter a valid date.')
    if (!String(body?.description || '').trim()) fieldError('description', 'This field is required.')
    const inc = {
      id: nextId(store, 'income'), date: body.date, source: body.source || 'other',
      description: String(body.description).trim(), amount: moneyField(body.amount, 'amount'),
    }
    store.incomes.push(inc); save(store)
    return inc
  },
  update: async (id, body) => {
    const store = load(); requireUser(store)
    const inc = store.incomes.find((x) => x.id === Number(id))
    if (!inc) throw new ApiError(404, { detail: 'Not found.' })
    if (body.date !== undefined) { if (!isValidDate(body.date)) fieldError('date', 'Enter a valid date.'); inc.date = body.date }
    if (body.description !== undefined) inc.description = String(body.description)
    if (body.source !== undefined) inc.source = body.source
    if (body.amount !== undefined) inc.amount = moneyField(body.amount, 'amount')
    save(store)
    return inc
  },
  remove: async (id) => {
    const store = load(); requireUser(store)
    const before = store.incomes.length
    store.incomes = store.incomes.filter((x) => x.id !== Number(id))
    if (store.incomes.length === before) throw new ApiError(404, { detail: 'Not found.' })
    save(store)
  },
}

// ---- Recurring rules (month-end/leap-year aware, idempotent generation) ----
function parseYMD(s) { const [y, m, d] = s.split('-').map(Number); return { y, m, d } }
function fmtYMD({ y, m, d }) { return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` }
function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate() }
function advanceDue(due, frequency) {
  const { y, m, d } = parseYMD(due)
  if (frequency === 'weekly') {
    const dt = new Date(Date.UTC(y, m - 1, d)); dt.setUTCDate(dt.getUTCDate() + 7)
    return fmtYMD({ y: dt.getUTCFullYear(), m: dt.getUTCMonth() + 1, d: dt.getUTCDate() })
  }
  if (frequency === 'monthly') {
    let ny = y; let nm = m + 1
    if (nm === 13) { ny += 1; nm = 1 }
    return fmtYMD({ y: ny, m: nm, d: Math.min(d, daysInMonth(ny, nm)) })
  }
  if (frequency === 'yearly') {
    return fmtYMD({ y: y + 1, m, d: Math.min(d, daysInMonth(y + 1, m)) })
  }
  throw new ApiError(400, { frequency: ['Unknown frequency.'] })
}
function ruleView(store, r) {
  return { ...r, category_name: r.category != null ? (catOf(store, r.category)?.name ?? null) : null }
}
function generateDueFor(store, today) {
  let created = 0
  for (const rule of store.recurring) {
    if (!rule.active) continue
    let guard = 0
    while (rule.next_due <= today && (!rule.end_date || rule.next_due <= rule.end_date) && guard < 366) {
      guard += 1
      const exists = store.expenses.some((e) => e.recurring_rule === rule.id && e.recurring_date === rule.next_due)
      if (!exists) {
        const c = catOf(store, rule.category)
        store.expenses.push({
          id: nextId(store, 'expense'), date: rule.next_due, category: rule.category,
          category_name: c ? c.name : null, category_color: c ? c.color : null, category_icon: c ? c.icon : null,
          description: rule.description, merchant: '', amount: rule.amount, payment_method: 'other',
          notes: '', tags: '', receipt: null, recurring_rule: rule.id, recurring_date: rule.next_due,
          created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
        })
        created += 1
      }
      rule.last_generated_date = rule.next_due
      rule.next_due = advanceDue(rule.next_due, rule.frequency)
    }
  }
  return created
}
export const localRecurringApi = {
  list: async (params = {}) => {
    const store = load(); requireUser(store)
    return paginate(store.recurring.map((r) => ruleView(store, r)), params)
  },
  get: async (id) => {
    const store = load(); requireUser(store)
    const r = store.recurring.find((x) => x.id === Number(id))
    if (!r) throw new ApiError(404, { detail: 'Not found.' })
    return ruleView(store, r)
  },
  create: async (body) => {
    const store = load(); requireUser(store)
    if (!String(body?.description || '').trim()) fieldError('description', 'This field is required.')
    if (!isValidDate(body?.start_date)) fieldError('start_date', 'Enter a valid date.')
    if (body?.end_date && !isValidDate(body.end_date)) fieldError('end_date', 'Enter a valid date.')
    if (!['weekly', 'monthly', 'yearly'].includes(body?.frequency)) fieldError('frequency', 'Unknown frequency.')
    const c = resolveCategory(store, body.category)
    if (!c) fieldError('category', 'Unknown category.')
    const r = {
      id: nextId(store, 'recurring'), category: c.id, description: String(body.description).trim(),
      amount: moneyField(body.amount, 'amount'), frequency: body.frequency, start_date: body.start_date,
      end_date: body.end_date || null, next_due: body.start_date, active: body.active !== false,
      last_generated_date: null,
    }
    store.recurring.push(r); save(store)
    return ruleView(store, r)
  },
  update: async (id, body) => {
    const store = load(); requireUser(store)
    const r = store.recurring.find((x) => x.id === Number(id))
    if (!r) throw new ApiError(404, { detail: 'Not found.' })
    if (body.description !== undefined) r.description = String(body.description)
    if (body.amount !== undefined) r.amount = moneyField(body.amount, 'amount')
    if (body.frequency !== undefined) {
      if (!['weekly', 'monthly', 'yearly'].includes(body.frequency)) fieldError('frequency', 'Unknown frequency.')
      r.frequency = body.frequency
    }
    if (body.start_date !== undefined) { if (!isValidDate(body.start_date)) fieldError('start_date', 'Enter a valid date.'); r.start_date = body.start_date }
    if (body.end_date !== undefined) r.end_date = body.end_date || null
    if (body.active !== undefined) r.active = !!body.active
    if (body.category !== undefined) {
      const c = resolveCategory(store, body.category)
      if (!c) fieldError('category', 'Unknown category.')
      r.category = c.id
    }
    save(store)
    return ruleView(store, r)
  },
  remove: async (id) => {
    const store = load(); requireUser(store)
    const before = store.recurring.length
    store.recurring = store.recurring.filter((r) => r.id !== Number(id))
    if (store.recurring.length === before) throw new ApiError(404, { detail: 'Not found.' })
    save(store)
  },
  generateDue: async () => {
    const store = load(); requireUser(store)
    const created = generateDueFor(store, todayInKolkata())
    save(store)
    return { created }
  },
}

// ---- Savings goals + contributions ----
function goalView(store, g) {
  const saved = sumMoney(store.contributions.filter((c) => c.goal === g.id).map((c) => c.amount))
  const target = toPaise(g.target_amount)
  const pct = target > 0n ? (Number((toPaise(saved) * 10000n) / target) / 100).toFixed(2) : '0.00'
  return { ...g, saved_amount: saved, progress_percent: pct }
}
export const localGoalsApi = {
  list: async (params = {}) => {
    const store = load(); requireUser(store)
    return paginate(store.goals.map((g) => goalView(store, g)), params)
  },
  get: async (id) => {
    const store = load(); requireUser(store)
    const g = store.goals.find((x) => x.id === Number(id))
    if (!g) throw new ApiError(404, { detail: 'Not found.' })
    return goalView(store, g)
  },
  create: async (body) => {
    const store = load(); requireUser(store)
    if (!String(body?.name || '').trim()) fieldError('name', 'This field is required.')
    if (body?.target_date && !isValidDate(body.target_date)) fieldError('target_date', 'Enter a valid date.')
    const g = {
      id: nextId(store, 'goal'), name: String(body.name).trim(),
      target_amount: moneyField(body.target_amount, 'target_amount'),
      target_date: body.target_date || null, description: String(body.description || ''),
    }
    store.goals.push(g); save(store)
    return goalView(store, g)
  },
  update: async (id, body) => {
    const store = load(); requireUser(store)
    const g = store.goals.find((x) => x.id === Number(id))
    if (!g) throw new ApiError(404, { detail: 'Not found.' })
    if (body.name !== undefined) g.name = String(body.name)
    if (body.target_amount !== undefined) g.target_amount = moneyField(body.target_amount, 'target_amount')
    if (body.target_date !== undefined) g.target_date = body.target_date || null
    if (body.description !== undefined) g.description = String(body.description)
    save(store)
    return goalView(store, g)
  },
  remove: async (id) => {
    const store = load(); requireUser(store)
    const before = store.goals.length
    store.goals = store.goals.filter((g) => g.id !== Number(id))
    store.contributions = store.contributions.filter((c) => c.goal !== Number(id))
    if (store.goals.length === before) throw new ApiError(404, { detail: 'Not found.' })
    save(store)
  },
  contributions: {
    list: async (goalId) => {
      const store = load(); requireUser(store)
      return paginate(store.contributions.filter((c) => c.goal === Number(goalId)), {})
    },
    create: async (goalId, body) => {
      const store = load(); requireUser(store)
      const g = store.goals.find((x) => x.id === Number(goalId))
      if (!g) throw new ApiError(404, { detail: 'Not found.' })
      if (!isValidDate(body?.date)) fieldError('date', 'Enter a valid date.')
      const c = {
        id: nextId(store, 'contribution'), goal: g.id, amount: moneyField(body.amount, 'amount'),
        date: body.date, note: String(body.note || ''),
      }
      store.contributions.push(c); save(store)
      return c
    },
    remove: async (goalId, id) => {
      const store = load(); requireUser(store)
      const before = store.contributions.length
      store.contributions = store.contributions.filter((c) => !(c.goal === Number(goalId) && c.id === Number(id)))
      if (store.contributions.length === before) throw new ApiError(404, { detail: 'Not found.' })
      save(store)
    },
  },
}

// ---- Analytics (same response shape as the Django endpoint) ----
function pctOf(partPaise, wholePaise) {
  if (wholePaise === 0n) return '0.00'
  return (Number((partPaise * 10000n) / wholePaise) / 100).toFixed(2)
}
function prevMonthOf(yyyyMm) {
  let [y, m] = yyyyMm.split('-').map(Number)
  m -= 1
  if (m === 0) { y -= 1; m = 12 }
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}`
}
export const localAnalyticsApi = {
  get: async (params = {}) => {
    const store = load(); requireUser(store)
    const today = todayInKolkata()
    let month = params.month || today.slice(0, 7)
    let start = `${month}-01`
    let end = `${month}-${String(daysInMonth(...month.split('-').map(Number))).padStart(2, '0')}`
    if (!params.month && (params.from || params.to)) {
      start = isValidDate(params.from) ? params.from : `${today.slice(0, 7)}-01`
      end = isValidDate(params.to) ? params.to : today
      month = start.slice(0, 7)
    }
    const inRange = (d) => d >= start && d <= end
    const expenses = store.expenses.filter((e) => inRange(e.date))
    const incomes = store.incomes.filter((i) => inRange(i.date))
    const spentP = expenses.reduce((a, e) => a + toPaise(e.amount), 0n)
    const incomeP = incomes.reduce((a, i) => a + toPaise(i.amount), 0n)
    const netP = incomeP - spentP
    const prevMonth = prevMonthOf(month)
    const prevSpentP = store.expenses.filter((e) => e.date.startsWith(prevMonth)).reduce((a, e) => a + toPaise(e.amount), 0n)
    const delta = prevSpentP === 0n ? (spentP === 0n ? '0.00' : '100.00') : pctOf(spentP - prevSpentP, prevSpentP)
    const days = Number(end.slice(8))
    const dailyAverageP = days ? spentP / BigInt(days) : 0n
    const dailyTrend = []
    for (let d = 1; d <= days; d += 1) {
      const date = `${month}-${String(d).padStart(2, '0')}`
      dailyTrend.push({ date, spent: sumMoney(expenses.filter((e) => e.date === date).map((e) => e.amount)) })
    }
    const byCat = new Map()
    for (const e of expenses) {
      const name = e.category_name || 'Uncategorized'
      const cur = byCat.get(name) || { total: 0n, count: 0 }
      cur.total += toPaise(e.amount); cur.count += 1
      byCat.set(name, cur)
    }
    const breakdown = [...byCat.entries()]
      .map(([category, v]) => ({ category, total: fromPaise(v.total), count: v.count, share: pctOf(v.total, spentP) }))
      .sort((a, b) => toPaise(b.total) - toPaise(a.total) || 0)
    const topCategory = breakdown[0] || null
    const byMethod = new Map()
    for (const e of expenses) {
      const m = (e.payment_method || 'other').toUpperCase()
      const cur = byMethod.get(m) || { total: 0n, count: 0 }
      cur.total += toPaise(e.amount); cur.count += 1
      byMethod.set(m, cur)
    }
    const paymentMethodBreakdown = [...byMethod.entries()]
      .map(([method, v]) => ({ method, total: fromPaise(v.total), count: v.count, share: pctOf(v.total, spentP) }))
      .sort((a, b) => Number(toPaise(b.total) - toPaise(a.total)))
    const comparison = []
    let cy = Number(month.slice(0, 4)); let cm = Number(month.slice(5, 7))
    const months = []
    for (let i = 0; i < 6; i += 1) { months.unshift(`${String(cy).padStart(4, '0')}-${String(cm).padStart(2, '0')}`); const p = prevMonthOf(`${String(cy).padStart(4, '0')}-${String(cm).padStart(2, '0')}`); cy = Number(p.slice(0, 4)); cm = Number(p.slice(5, 7)) }
    for (const mm of months) {
      comparison.push({
        month: mm,
        spent: sumMoney(store.expenses.filter((e) => e.date.startsWith(mm)).map((e) => e.amount)),
        income: sumMoney(store.incomes.filter((i) => i.date.startsWith(mm)).map((i) => i.amount)),
      })
    }
    const overall = store.budgets.find((b) => b.month === start && b.category === null) || null
    const budgetsOut = { overall: null, categories: [] }
    if (overall) {
      const op = toPaise(overall.amount)
      budgetsOut.overall = {
        budgeted: overall.amount, spent: fromPaise(spentP), remaining: fromPaise(op - spentP),
        percent_used: pctOf(spentP, op), alert_threshold: overall.alert_threshold,
        over_threshold: spentP >= (op * BigInt(overall.alert_threshold)) / 100n, over_budget: spentP > op,
      }
    }
    for (const b of store.budgets.filter((x) => x.month === start && x.category !== null)) {
      const catSpent = expenses.filter((e) => e.category === b.category).reduce((a, e) => a + toPaise(e.amount), 0n)
      const bp = toPaise(b.amount)
      budgetsOut.categories.push({
        category: catOf(store, b.category)?.name ?? null, category_id: b.category,
        budgeted: b.amount, spent: fromPaise(catSpent), remaining: fromPaise(bp - catSpent),
        percent_used: pctOf(catSpent, bp), alert_threshold: b.alert_threshold,
        over_threshold: catSpent >= (bp * BigInt(b.alert_threshold)) / 100n, over_budget: catSpent > bp,
      })
    }
    const insights = []
    if (topCategory) insights.push(`Top category: ${topCategory.category} at ₹${topCategory.total} (${topCategory.share}% of spend).`)
    const prevMap = new Map()
    for (const e of store.expenses.filter((x) => x.date.startsWith(prevMonth))) {
      const n = e.category_name || 'Uncategorized'
      prevMap.set(n, (prevMap.get(n) || 0n) + toPaise(e.amount))
    }
    let biggest = null
    for (const b of breakdown) {
      const inc = toPaise(b.total) - (prevMap.get(b.category) || 0n)
      if (inc > 0n && (!biggest || inc > biggest.inc)) biggest = { name: b.category, inc }
    }
    if (biggest) insights.push(`Biggest increase vs previous month: ${biggest.name} up by ₹${fromPaise(biggest.inc)}.`)
    if (dailyAverageP > 0n) {
      for (const d of dailyTrend) {
        if (toPaise(d.spent) > 2n * dailyAverageP) {
          insights.push(`Unusual spend on ${d.date}: ₹${d.spent} (daily average ₹${fromPaise(dailyAverageP)}).`)
        }
      }
    }
    if (budgetsOut.overall?.over_budget) insights.push('Overall budget exceeded for this month.')
    for (const g of store.goals) {
      const v = goalView(store, g)
      if (Number(v.progress_percent) >= 100) insights.push(`Goal '${g.name}' reached (${v.progress_percent}%).`)
      else if (Number(v.progress_percent) >= 80) insights.push(`Goal '${g.name}' is close at ${v.progress_percent}% of target.`)
    }
    if (netP < 0n) insights.push(`Spending exceeded income by ₹${fromPaise(-netP)} this period.`)
    return {
      month, from: start, to: end,
      totals: {
        spent: fromPaise(spentP), income: fromPaise(incomeP), net: fromPaise(netP),
        expense_count: expenses.length, income_count: incomes.length,
      },
      previous_month: { month: prevMonth, spent: fromPaise(prevSpentP), delta_percent: delta },
      daily_trend: dailyTrend,
      daily_average: fromPaise(dailyAverageP),
      category_breakdown: breakdown,
      payment_method_breakdown: paymentMethodBreakdown,
      top_category: topCategory,
      monthly_comparison: comparison,
      budgets: budgetsOut,
      insights,
    }
  },
}

export function exportLocalBackup() {
  const store = load()
  requireUser(store)
  return JSON.stringify({
    version: 1,
    exported_at: new Date().toISOString(),
    store,
  }, null, 2)
}

export function importLocalBackup(rawJson) {
  let parsed
  try {
    parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson
  } catch {
    throw new ApiError(400, { detail: 'Invalid backup file: not valid JSON.' })
  }
  const incoming = parsed?.store && typeof parsed.store === 'object' ? parsed.store : parsed
  if (!incoming || typeof incoming !== 'object' || !Array.isArray(incoming.categories) || !Array.isArray(incoming.expenses)) {
    throw new ApiError(400, { detail: 'Invalid backup file: missing categories or expenses arrays.' })
  }
  const current = load()
  const base = emptyStore()
  const merged = {
    user: incoming.user || current.user,
    seq: { ...base.seq, ...(incoming.seq || {}) },
    categories: Array.isArray(incoming.categories) ? incoming.categories : [],
    expenses: Array.isArray(incoming.expenses) ? incoming.expenses : [],
    budgets: Array.isArray(incoming.budgets) ? incoming.budgets : [],
    incomes: Array.isArray(incoming.incomes) ? incoming.incomes : [],
    recurring: Array.isArray(incoming.recurring) ? incoming.recurring : [],
    goals: Array.isArray(incoming.goals) ? incoming.goals : [],
    contributions: Array.isArray(incoming.contributions) ? incoming.contributions : [],
  }
  refreshExpenseCategories(merged)
  save(merged)
  if (merged.user) setToken('local')
  return {
    categories: merged.categories.length,
    expenses: merged.expenses.length,
    incomes: merged.incomes.length,
    budgets: merged.budgets.length,
    recurring: merged.recurring.length,
    goals: merged.goals.length,
  }
}
