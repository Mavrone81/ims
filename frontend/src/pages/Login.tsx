import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '../auth';
import { api, ApiRequestError } from '../api';

interface Company {
  id: string;
  name: string;
}

export default function Login() {
  const { login } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');

  // login state
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  // register state
  const [companies, setCompanies] = useState<Company[]>([]);
  const [reg, setReg] = useState({ org_id: '', username: '', full_name: '', email: '', password: '' });
  const [regMsg, setRegMsg] = useState('');

  useEffect(() => {
    if (mode === 'register' && companies.length === 0) {
      api<{ data: Company[] }>('/auth/companies').then((r) => setCompanies(r.data)).catch(() => {});
    }
  }, [mode, companies.length]);

  async function submitLogin(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(username, password);
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  async function submitRegister(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    setRegMsg('');
    try {
      const res = await api<{ status: string; message: string }>('/auth/register', {
        method: 'POST',
        body: { ...reg, email: reg.email || null },
      });
      setRegMsg(res.message);
      if (res.status === 'approved') {
        // can sign in immediately — prefill the login form
        setUsername(reg.username);
        setTimeout(() => setMode('login'), 1500);
      }
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Registration failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      {mode === 'login' ? (
        <form className="card login-card" onSubmit={submitLogin}>
          <img src="/logo.svg" alt="IMS logo" className="login-logo" />
          <h1>IMS</h1>
          <p>Inventory Management System — sign in to continue</p>
          <div className="field">
            <label>Username</label>
            <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoFocus required />
          </div>
          <div className="field">
            <label>Password</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
          </div>
          {error && <div className="error-text">{error}</div>}
          <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
          <p style={{ marginTop: 16, textAlign: 'center' }}>
            New here?{' '}
            <a href="#" onClick={(e) => { e.preventDefault(); setError(''); setMode('register'); }}>
              Register a new user
            </a>
          </p>
        </form>
      ) : (
        <form className="card login-card" onSubmit={submitRegister}>
          <img src="/logo.svg" alt="IMS logo" className="login-logo" />
          <h1>Register</h1>
          <p>Create an account and request access to a company</p>

          {regMsg ? (
            <>
              <div className="balance-preview" style={{ marginBottom: 16 }}>{regMsg}</div>
              <button type="button" className="btn" style={{ width: '100%' }} onClick={() => { setMode('login'); setRegMsg(''); }}>
                Back to sign in
              </button>
            </>
          ) : (
            <>
              <div className="field">
                <label>Company *</label>
                <select value={reg.org_id} onChange={(e) => setReg({ ...reg, org_id: e.target.value })} required>
                  <option value="">Select your company…</option>
                  {companies.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="field">
                <label>Username *</label>
                <input value={reg.username} onChange={(e) => setReg({ ...reg, username: e.target.value })} autoComplete="username" required />
              </div>
              <div className="field">
                <label>Full name *</label>
                <input value={reg.full_name} onChange={(e) => setReg({ ...reg, full_name: e.target.value })} required />
              </div>
              <div className="field">
                <label>Email (optional)</label>
                <input type="email" value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} />
              </div>
              <div className="field">
                <label>Password * (min 8 characters)</label>
                <input type="password" value={reg.password} onChange={(e) => setReg({ ...reg, password: e.target.value })} autoComplete="new-password" required />
              </div>
              {error && <div className="error-text">{error}</div>}
              <button className="btn" style={{ width: '100%', marginTop: 8 }}
                disabled={busy || !reg.org_id || !reg.username || !reg.full_name || reg.password.length < 8}>
                {busy ? 'Submitting…' : 'Register'}
              </button>
              <p style={{ marginTop: 16, textAlign: 'center' }}>
                Already have an account?{' '}
                <a href="#" onClick={(e) => { e.preventDefault(); setError(''); setMode('login'); }}>Sign in</a>
              </p>
            </>
          )}
        </form>
      )}
    </div>
  );
}
