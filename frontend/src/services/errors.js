// Shared API error type and message parsing, used by both the server client
// and the on-device client so the UI sees identical error shapes.
export class ApiError extends Error {
  constructor(status, data) {
    super(typeof data === 'string' ? data : 'Request failed')
    this.status = status; this.data = data
    this.fieldErrors = data && typeof data === 'object' ? data : {}
  }
}

export function parseErrorMessage(err) {
  if (err instanceof ApiError) {
    const d = err.data
    if (typeof d === 'string') return d
    if (d && typeof d === 'object') {
      if (d.detail) return String(d.detail)
      const first = Object.values(d).flat()[0]
      if (first) return Array.isArray(first) ? String(first[0]) : String(first)
    }
    return err.status === 401 ? 'Please log in again.' : `Request failed (${err.status || 'network'}).`
  }
  return err?.message || 'Network error. Is the backend running?'
}
