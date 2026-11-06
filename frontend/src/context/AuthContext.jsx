/* eslint-disable react-refresh/only-export-components -- context file intentionally co-exports its hook and provider. */
import { createContext, useContext, useEffect, useState } from 'react'
import { authApi, getToken } from '../services/api.js'
const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)
export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    if (!getToken()) { setLoading(false); return }
    authApi.me().then(setUser).catch(() => setUser(null)).finally(() => setLoading(false))
  }, [])
  const login = async (body) => { const d = await authApi.login(body); setUser(d.user ?? null); return d }
  const register = async (body) => { const d = await authApi.register(body); setUser(d.user ?? null); return d }
  const logout = async () => { await authApi.logout(); setUser(null) }
  return <Ctx.Provider value={{ user, loading, token: getToken(), login, register, logout }}>{children}</Ctx.Provider>
}
