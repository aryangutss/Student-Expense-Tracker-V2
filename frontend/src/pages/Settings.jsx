import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Download, Moon, Sun, Upload } from 'lucide-react'
import { API_BASE, authApi, getEffectiveBase, parseErrorMessage } from '../services/api.js'
import { exportLocalBackup, importLocalBackup } from '../services/localApi.js'
import { getMode, getServerUrl, setMode, setServerUrl } from '../services/mode.js'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { useTheme } from '../hooks/useList.js'
import { downloadTextFile, todayInKolkata } from '../utils/format.js'
import { GlassCard, PageHeader } from '../components/ui.jsx'

export default function Settings() {
  const { user, logout } = useAuth()
  const { theme, toggle } = useTheme()
  const { push } = useToast()
  const navigate = useNavigate()
  const fileRef = useRef(null)
  const [status, setStatus] = useState('Checking…')
  const [mode, setModeState] = useState(getMode())
  const [serverUrl, setServerUrlState] = useState(getServerUrl())
  useEffect(() => { authApi.me().then(() => setStatus(mode === 'local' ? 'On-device mode — data is stored in this app only.' : 'Connected — backend responded to /api/auth/me/.')).catch((e) => setStatus(`Backend check failed: ${parseErrorMessage(e)}`)) }, [mode])
  const switchMode = async (next) => {
    if (next === mode) return
    await logout()
    setMode(next)
    setModeState(next)
    push(next === 'local' ? 'Switched to on-device mode. Log in (or create) your on-device account.' : 'Switched to server mode. Log in with your server account.')
    navigate('/login')
  }
  const saveServerUrl = () => { setServerUrl(serverUrl.trim()); push('Server URL saved.'); setStatus('Checking…'); authApi.me().then(() => setStatus('Connected — backend responded to /api/auth/me/.')).catch((e) => setStatus(`Backend check failed: ${parseErrorMessage(e)}`)) }
  const handleExportBackup = () => {
    try {
      const json = exportLocalBackup()
      downloadTextFile(`expense-tracker-backup-${todayInKolkata()}.json`, json, 'application/json;charset=utf-8')
      push('On-device backup exported as JSON.')
    } catch (e) {
      push(parseErrorMessage(e), 'error')
    }
  }
  const handleImportBackup = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const text = await file.text()
      const summary = importLocalBackup(text)
      push(`Backup restored: ${summary.expenses} expenses, ${summary.incomes} incomes, ${summary.budgets} budgets, ${summary.goals} goals.`)
    } catch (err) {
      push(parseErrorMessage(err), 'error')
    }
  }
  return <>
    <PageHeader title="Settings" subtitle="Account, appearance and backend status." />
    <div className="grid grid-2">
      <GlassCard><h2>Connection</h2>
        <p className="small muted">Where your data lives. Server and on-device data are completely separate — switching signs you out.</p>
        <p className="small" style={{ marginTop: 10 }}>Current mode: <strong>{mode === 'local' ? 'On-device' : 'Server'}</strong></p>
        <p className="small muted" style={{ wordBreak: 'break-all' }}>Effective data source: {getEffectiveBase()}</p>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          <button type="button" className="btn" disabled={mode === 'local'} onClick={() => switchMode('local')}>Use on-device storage</button>
          <button type="button" className="btn" disabled={mode === 'server'} onClick={() => switchMode('server')}>Use a server</button>
        </div>
        {mode === 'server' && <>
          <div className="field" style={{ marginTop: 14 }}><label htmlFor="server-url">Server URL (for example, your laptop on the same Wi-Fi, or a deployed backend)</label>
            <input id="server-url" value={serverUrl} onChange={(e) => setServerUrlState(e.target.value)} placeholder="http://192.168.1.10:8000" /></div>
          <button type="button" className="btn btn-primary" style={{ marginTop: 8 }} onClick={saveServerUrl}>Save server URL</button>
          <p className="small muted" style={{ marginTop: 8 }}>For a laptop server, run it on 0.0.0.0 and add the phone's network address to the backend&apos;s CORS_ALLOWED_ORIGINS and DJANGO_ALLOWED_HOSTS.</p>
        </>}
        {mode === 'local' && <>
          <p className="small muted" style={{ marginTop: 10 }}>On-device data never leaves this device and does not sync. Export a JSON backup below before uninstalling or switching devices.</p>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={handleExportBackup}><Download size={16} /> Export JSON backup</button>
            <button type="button" className="btn" onClick={() => fileRef.current?.click()}><Upload size={16} /> Restore JSON backup</button>
            <input ref={fileRef} type="file" accept=".json,application/json" style={{ display: 'none' }} onChange={handleImportBackup} />
          </div>
        </>}
      </GlassCard>
      <GlassCard><h2>Account</h2>
        <p className="small muted">Username</p><p>{user?.username || '—'}</p>
        <p className="small muted" style={{ marginTop: 10 }}>Email</p><p>{user?.email || 'Not provided'}</p>
        <p className="small muted" style={{ marginTop: 10 }}>User ID</p><p>{user?.id ?? '—'}</p>
        <button type="button" className="btn" style={{ marginTop: 14 }} onClick={async () => { await logout(); navigate('/login') }}>Log out</button>
      </GlassCard>
      <GlassCard><h2>Appearance</h2><p className="muted small">Theme is stored only in your browser (localStorage) — never financial data.</p>
        <button type="button" className="btn" style={{ marginTop: 12 }} onClick={toggle}>{theme === 'dark' ? <><Sun size={16} /> Switch to light theme</> : <><Moon size={16} /> Switch to dark theme</>}</button>
        <p className="small muted" style={{ marginTop: 8 }}>Current theme: {theme}</p></GlassCard>
      <GlassCard><h2>Currency</h2><p className="muted small">All amounts are in Indian Rupees (INR), formatted for India (en-IN) with 2 decimals. Money is handled as decimal strings, never float arithmetic, so shown totals never drift.</p></GlassCard>
      <GlassCard><h2>Backend status</h2><p className="small muted">API base URL (from VITE_API_URL)</p><p style={{ wordBreak: 'break-all' }}>{API_BASE}</p><p className="small" style={{ marginTop: 8 }}>{status}</p>
        <p className="small muted" style={{ marginTop: 10 }}>Data notes: {mode === 'local' ? 'On-device mode: your records live only in this app’s storage on this device.' : 'Server mode: your data is per-account (token auth). Only the auth token and the theme choice are stored in localStorage; no expenses, budgets or goals are stored locally.'} See the project README for full data notes.</p></GlassCard>
    </div>
  </>
}
