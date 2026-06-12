import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Modal, fmtDate, useToast, ToastProvider } from '../components/ui';

// Self-contained platform-admin console at /platform. Uses its own token
// (separate from org-user sessions) and only the /platform API.
const API = (import.meta.env.VITE_API_URL ?? '/api/v1') + '/platform';

function token() {
  return sessionStorage.getItem('ims.platform_token');
}

async function papi<T = any>(path: string, options: { method?: string; body?: any } = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const t = token();
  if (t) headers.Authorization = `Bearer ${t}`;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${API}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    sessionStorage.removeItem('ims.platform_token');
    window.dispatchEvent(new Event('platform-logout'));
  }
  if (!res.ok) throw new Error(data?.error?.message ?? res.statusText);
  return data;
}

interface Org {
  id: string;
  name: string;
  base_currency: string;
  is_active: boolean;
  require_user_approval: boolean;
  created_at: string;
  user_count: number;
  site_count: number;
  item_count: number;
}

export default function Platform() {
  return (
    <ToastProvider>
      <PlatformInner />
    </ToastProvider>
  );
}

function PlatformInner() {
  const [authed, setAuthed] = useState(!!token());

  useEffect(() => {
    const onLogout = () => setAuthed(false);
    window.addEventListener('platform-logout', onLogout);
    return () => window.removeEventListener('platform-logout', onLogout);
  }, []);

  return authed ? (
    <PlatformConsole onLogout={() => { sessionStorage.removeItem('ims.platform_token'); setAuthed(false); }} />
  ) : (
    <PlatformLogin onLogin={() => setAuthed(true)} />
  );
}

function PlatformLogin({ onLogin }: { onLogin: () => void }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      const res = await papi<{ access_token: string }>('/auth/login', {
        method: 'POST',
        body: { username, password },
      });
      sessionStorage.setItem('ims.platform_token', res.access_token);
      onLogin();
    } catch (err: any) {
      setError(err.message ?? 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="login-page">
      <form className="card login-card" onSubmit={submit}>
        <img src="/logo.svg" alt="IMS logo" className="login-logo" />
        <h1>IMS Platform</h1>
        <p>Platform administration — provision and manage company accounts</p>
        <div className="field">
          <label>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus required />
        </div>
        <div className="field">
          <label>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </div>
        {error && <div className="error-text">{error}</div>}
        <button className="btn" style={{ width: '100%', marginTop: 8 }} disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        <p style={{ marginTop: 14 }}>
          <a href="/">← Company sign-in</a>
        </p>
      </form>
    </div>
  );
}

function PlatformConsole({ onLogout }: { onLogout: () => void }) {
  const toast = useToast();
  const [orgs, setOrgs] = useState<Org[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [error, setError] = useState('');
  const [created, setCreated] = useState<{ name: string; admin_username: string } | null>(null);

  const load = useCallback(() => {
    papi<{ data: Org[] }>('/orgs').then((r) => setOrgs(r.data)).catch(() => {});
  }, []);
  useEffect(load, [load]);

  function openCreate() {
    setError('');
    setForm({
      name: '', base_currency: 'USD',
      admin_username: '', admin_password: '', admin_full_name: '', admin_email: '',
      site_code: 'MAIN', project_code: 'DEFAULT',
    });
    setShowCreate(true);
  }

  async function create() {
    setError('');
    try {
      const res = await papi('/orgs', {
        method: 'POST',
        body: { ...form, admin_email: form.admin_email || null },
      });
      setShowCreate(false);
      setCreated(res);
      load();
    } catch (err: any) {
      setError(err.message ?? 'Create failed');
    }
  }

  async function toggleActive(org: Org) {
    const verb = org.is_active ? 'Deactivate' : 'Reactivate';
    if (!confirm(`${verb} "${org.name}"? ${org.is_active ? 'Its users will no longer be able to sign in; data is kept.' : ''}`)) return;
    await papi(`/orgs/${org.id}`, { method: 'PATCH', body: { is_active: !org.is_active } });
    toast(`${org.name} ${org.is_active ? 'deactivated' : 'reactivated'}`);
    load();
  }

  async function toggleApproval(org: Org) {
    await papi(`/orgs/${org.id}`, { method: 'PATCH', body: { require_user_approval: !org.require_user_approval } });
    toast(`${org.name}: self-registration approval ${org.require_user_approval ? 'turned OFF (auto-approve)' : 'turned ON'}`);
    load();
  }

  return (
    <div className="content" style={{ paddingTop: 24 }}>
      <div className="page-head">
        <h2>
          <img src="/logo.svg" alt="" style={{ width: 26, height: 26, verticalAlign: 'text-bottom', marginRight: 8 }} />
          Platform · Companies
        </h2>
        <button className="btn" onClick={openCreate}>+ New company</button>
        <button className="btn secondary" onClick={onLogout}>Sign out</button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Company</th><th>Base currency</th><th className="num">Users</th>
              <th className="num">Sites</th><th className="num">Items</th>
              <th>Created</th><th>Status</th><th>Self-reg approval</th><th />
            </tr>
          </thead>
          <tbody>
            {orgs.map((o) => (
              <tr key={o.id}>
                <td><strong>{o.name}</strong></td>
                <td>{o.base_currency}</td>
                <td className="num">{o.user_count}</td>
                <td className="num">{o.site_count}</td>
                <td className="num">{o.item_count}</td>
                <td>{fmtDate(o.created_at)}</td>
                <td>{o.is_active ? <span className="badge green">active</span> : <span className="badge red">inactive</span>}</td>
                <td>
                  <button className="btn ghost sm" onClick={() => toggleApproval(o)} title="Toggle whether self-registered users need admin approval">
                    {o.require_user_approval
                      ? <span className="badge amber">required</span>
                      : <span className="badge gray">auto-approve</span>}
                  </button>
                </td>
                <td>
                  <button className="btn ghost sm" onClick={() => toggleActive(o)}>
                    {o.is_active ? 'Deactivate' : 'Reactivate'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showCreate && (
        <Modal title="Provision a new company" onClose={() => setShowCreate(false)} wide>
          <div className="form-row">
            <div className="field"><label>Company name *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div className="field"><label>Base currency</label>
              <input maxLength={3} value={form.base_currency}
                onChange={(e) => setForm({ ...form, base_currency: e.target.value.toUpperCase() })} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Site code</label>
              <input value={form.site_code} onChange={(e) => setForm({ ...form, site_code: e.target.value })} /></div>
            <div className="field"><label>Project code</label>
              <input value={form.project_code} onChange={(e) => setForm({ ...form, project_code: e.target.value })} /></div>
          </div>
          <h3 style={{ fontSize: 15, margin: '8px 0 12px' }}>Company admin login</h3>
          <div className="form-row">
            <div className="field"><label>Admin username *</label>
              <input value={form.admin_username} onChange={(e) => setForm({ ...form, admin_username: e.target.value })} /></div>
            <div className="field"><label>Admin password * (min 8)</label>
              <input type="text" value={form.admin_password}
                onChange={(e) => setForm({ ...form, admin_password: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Admin full name *</label>
              <input value={form.admin_full_name} onChange={(e) => setForm({ ...form, admin_full_name: e.target.value })} /></div>
            <div className="field"><label>Admin email (optional)</label>
              <input type="email" value={form.admin_email} onChange={(e) => setForm({ ...form, admin_email: e.target.value })} /></div>
          </div>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setShowCreate(false)}>Cancel</button>
            <button className="btn"
              disabled={!form.name || !form.admin_username || (form.admin_password?.length ?? 0) < 8 || !form.admin_full_name}
              onClick={create}>
              Create company
            </button>
          </div>
        </Modal>
      )}

      {created && (
        <Modal title="Company created" onClose={() => setCreated(null)}>
          <p style={{ marginBottom: 14 }}>
            <strong>{created.name}</strong> is ready. Share these sign-in details with the company admin:
          </p>
          <div className="balance-preview">
            URL: <strong>{window.location.origin}</strong><br />
            Username: <strong>{created.admin_username}</strong><br />
            Password: <strong>(as entered)</strong>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>
            They sign in at the normal company login and have full org-admin rights:
            sites, projects, users, custom fields, currencies.
          </p>
          <div className="modal-actions">
            <button className="btn" onClick={() => setCreated(null)}>Done</button>
          </div>
        </Modal>
      )}
    </div>
  );
}
