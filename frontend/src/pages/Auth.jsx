import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Wallet } from 'lucide-react'
import { useAuth } from '../context/AuthContext.jsx'
import { useToast } from '../context/ToastContext.jsx'
import { parseErrorMessage } from '../services/api.js'

function Field({ id, label, ...props }) {
  return <div className="field"><label htmlFor={id}>{label}</label><input id={id} {...props} /></div>
}
export function Login() {
  const { login } = useAuth(); const { push } = useToast(); const navigate = useNavigate()
  const [username, setUsername] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async (e) => { e.preventDefault(); setBusy(true); setError('')
    try { await login({ username, password }); push('Welcome back!'); navigate('/') } catch (err) { const m = parseErrorMessage(err); setError(m); push(m, 'error') } finally { setBusy(false) } }
  return <div className="auth-wrap"><section className="glass auth-card"><div className="brand"><span className="brand-mark"><Wallet size={20} color="#fff" /></span>Student Expense Tracker</div>
    <h1 style={{ fontSize: 26 }}>Log in</h1><p className="muted small" style={{ marginBottom: 16 }}>Your expenses, budgets and goals — per account, private to you.</p>
    <form onSubmit={submit} className="form-grid">
      <Field id="login-user" label="Username" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
      <Field id="login-pass" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="current-password" />
      {error && <p role="alert" className="field-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Logging in…' : 'Log in'}</button>
    </form><p className="small muted" style={{ marginTop: 14 }}>No account? <Link to="/register">Create one</Link></p></section></div>
}
export function Register() {
  const { register } = useAuth(); const { push } = useToast(); const navigate = useNavigate()
  const [username, setUsername] = useState(''); const [email, setEmail] = useState(''); const [password, setPassword] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState('')
  const submit = async (e) => { e.preventDefault(); setBusy(true); setError('')
    try { await register({ username, email: email || undefined, password }); push('Account created. Welcome!'); navigate('/') } catch (err) { const m = parseErrorMessage(err); setError(m); push(m, 'error') } finally { setBusy(false) } }
  return <div className="auth-wrap"><section className="glass auth-card"><div className="brand"><span className="brand-mark"><Wallet size={20} color="#fff" /></span>Student Expense Tracker</div>
    <h1 style={{ fontSize: 26 }}>Create account</h1>
    <form onSubmit={submit} className="form-grid">
      <Field id="reg-user" label="Username" value={username} onChange={(e) => setUsername(e.target.value)} required autoComplete="username" />
      <Field id="reg-email" label="Email (optional)" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
      <Field id="reg-pass" label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required autoComplete="new-password" />
      {error && <p role="alert" className="field-error">{error}</p>}
      <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'}</button>
    </form><p className="small muted" style={{ marginTop: 14 }}>Already have an account? <Link to="/login">Log in</Link></p></section></div>
}
