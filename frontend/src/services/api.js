// Central API client. Two data modes share one interface:
//  - 'server': the Django REST API (default on the web).
//  - 'local': on-device storage (default inside the Android app), implemented
//    in localApi.js with the same shapes, so pages never know the difference.
// The server base URL comes from VITE_API_URL, optionally overridden by a
// URL saved in Settings (server mode only). No component hardcodes a host.
// Auth token handling lives in token.js; error types in errors.js. Money is
// passed through as strings.
import { getMode, getServerUrl } from './mode.js'
import { getToken, setToken, clearToken } from './token.js'
import { ApiError, parseErrorMessage } from './errors.js'
import {
  localAnalyticsApi, localAuthApi, localBudgetsApi, localCategoriesApi,
  localExpensesApi, localGoalsApi, localIncomesApi, localRecurringApi,
} from './localApi.js'

export { ApiError, parseErrorMessage }
export { getToken, setToken, clearToken }

const ENV_BASE = (import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')
export const API_BASE = ENV_BASE
export function getEffectiveBase() {
  return getMode() === 'server' ? (getServerUrl() || ENV_BASE) : 'On-device storage'
}

async function request(path, { method = 'GET', body, isForm = false } = {}) {
  const base = getMode() === 'server' ? (getServerUrl() || ENV_BASE) : ENV_BASE
  const headers = {}
  const token = getToken()
  if (token) headers.Authorization = `Token ${token}`
  let payload = body
  if (body && !isForm) { headers['Content-Type'] = 'application/json'; payload = JSON.stringify(body) }
  let res
  try { res = await fetch(`${base}${path}`, { method, headers, body: payload }) }
  catch { throw new ApiError(0, 'Cannot reach the backend. Check it is running and the server URL in Settings is correct.') }
  const text = await res.text()
  let data
  try { data = text ? JSON.parse(text) : null } catch { data = text }
  if (!res.ok) throw new ApiError(res.status, data)
  return data
}

export function normalizeList(data) {
  if (!data) return { results: [], count: 0, next: null, previous: null }
  if (Array.isArray(data)) return { results: data, count: data.length, next: null, previous: null }
  return { results: data.results ?? [], count: data.count ?? (data.results?.length ?? 0), next: data.next ?? null, previous: data.previous ?? null }
}
function qs(params = {}) {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== undefined && v !== null && v !== '') q.append(k, v) })
  const s = q.toString()
  return s ? `?${s}` : ''
}
const crud = (base) => ({
  list: async (params) => normalizeList(await request(`${base}${qs(params)}`)),
  get: (id) => request(`${base}${id}/`),
  create: (body, isForm) => request(base, { method: 'POST', body, isForm }),
  update: (id, body, isForm) => request(`${base}${id}/`, { method: 'PATCH', body, isForm }),
  remove: (id) => request(`${base}${id}/`, { method: 'DELETE' }),
})

const serverAuthApi = {
  register: async (body) => { const d = await request('/api/auth/register/', { method: 'POST', body }); if (d?.token) setToken(d.token); return d },
  login: async (body) => { const d = await request('/api/auth/login/', { method: 'POST', body }); if (d?.token) setToken(d.token); return d },
  logout: async () => { try { await request('/api/auth/logout/', { method: 'POST', body: {} }) } finally { clearToken() } },
  me: () => request('/api/auth/me/'),
}
const serverExpensesApi = {
  ...crud('/api/expenses/'),
  bulkImport: (body) => request('/api/expenses/bulk-import/', { method: 'POST', body }),
}
const serverCategoriesApi = crud('/api/categories/')
const serverBudgetsApi = crud('/api/budgets/')
const serverIncomesApi = crud('/api/incomes/')
const serverRecurringApi = {
  ...crud('/api/recurring/'),
  generateDue: () => request('/api/recurring/generate-due/', { method: 'POST', body: {} }),
}
const serverGoalsApi = {
  ...crud('/api/goals/'),
  contributions: {
    list: async (goalId) => normalizeList(await request(`/api/goals/${goalId}/contributions/`)),
    create: (goalId, body) => request(`/api/goals/${goalId}/contributions/`, { method: 'POST', body }),
    remove: (goalId, id) => request(`/api/goals/${goalId}/contributions/${id}/`, { method: 'DELETE' }),
  },
}
const serverAnalyticsApi = {
  get: (params) => request(`/api/analytics/${qs(params)}`),
}
const serverHealthApi = { status: () => request('/api/auth/me/') }

// Dispatch to the on-device implementation when the mode is 'local'.
// Nested objects (goals.contributions) are wrapped recursively.
function dual(server, local) {
  return new Proxy(server, {
    get(target, prop) {
      const serverValue = target[prop]
      const localValue = local?.[prop]
      if (serverValue && typeof serverValue === 'object' && localValue && typeof localValue === 'object') {
        return dual(serverValue, localValue)
      }
      if (typeof serverValue === 'function') {
        return (...args) => (getMode() === 'local' ? localValue(...args) : serverValue(...args))
      }
      return serverValue
    },
  })
}

export const authApi = dual(serverAuthApi, localAuthApi)
export const expensesApi = dual(serverExpensesApi, localExpensesApi)
export const categoriesApi = dual(serverCategoriesApi, localCategoriesApi)
export const budgetsApi = dual(serverBudgetsApi, localBudgetsApi)
export const incomesApi = dual(serverIncomesApi, localIncomesApi)
export const recurringApi = dual(serverRecurringApi, localRecurringApi)
export const goalsApi = dual(serverGoalsApi, localGoalsApi)
export const analyticsApi = dual(serverAnalyticsApi, localAnalyticsApi)
export const healthApi = dual(serverHealthApi, { status: () => localAuthApi.me() })
