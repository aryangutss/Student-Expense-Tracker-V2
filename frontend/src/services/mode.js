// Data-mode selection: 'server' (Django API) or 'local' (on-device storage).
// Server and on-device data are kept completely separate: switching modes
// signs the user out, and each mode has its own account and records.
// Inside a Capacitor native app the default is 'local', so the installed APK
// works immediately with no backend to configure.
const MODE_KEY = 'expense_tracker_mode'
const URL_KEY = 'expense_tracker_server_url'

export const isNative = () => typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.()

export function getMode() {
  const m = localStorage.getItem(MODE_KEY)
  if (m === 'local' || m === 'server') return m
  return isNative() ? 'local' : 'server'
}
export function setMode(m) { localStorage.setItem(MODE_KEY, m) }
export function getServerUrl() { return localStorage.getItem(URL_KEY) || '' }
export function setServerUrl(u) { u ? localStorage.setItem(URL_KEY, u) : localStorage.removeItem(URL_KEY) }
