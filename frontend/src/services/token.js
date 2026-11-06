// Auth token storage. Shared by the server client and the on-device client so
// login/logout behaviour is identical in both modes.
const TOKEN_KEY = 'expense_tracker_token'
export const getToken = () => localStorage.getItem(TOKEN_KEY)
export const setToken = (t) => (t ? localStorage.setItem(TOKEN_KEY, t) : localStorage.removeItem(TOKEN_KEY))
export const clearToken = () => localStorage.removeItem(TOKEN_KEY)
