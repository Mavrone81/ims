import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api';
import { useAuth } from '../auth';
import type { FieldDef, Lookup } from '../types';
import { Modal, useToast } from '../components/ui';

type Tab = 'fields' | 'categories' | 'labels' | 'structure' | 'users' | 'currency';

export default function Admin() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('fields');
  const isAdmin = !!user?.is_org_admin;

  return (
    <>
      <div className="page-head"><h2>Administration</h2></div>
      <div className="tabs">
        <button className={tab === 'fields' ? 'active' : ''} onClick={() => setTab('fields')}>Custom fields</button>
        <button className={tab === 'categories' ? 'active' : ''} onClick={() => setTab('categories')}>Categories</button>
        <button className={tab === 'labels' ? 'active' : ''} onClick={() => setTab('labels')}>Movement labels</button>
        {isAdmin && <button className={tab === 'structure' ? 'active' : ''} onClick={() => setTab('structure')}>Sites & Projects</button>}
        {isAdmin && <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>Users</button>}
        {isAdmin && <button className={tab === 'currency' ? 'active' : ''} onClick={() => setTab('currency')}>Currency & FX</button>}
      </div>
      {tab === 'fields' && <CustomFieldsTab />}
      {tab === 'categories' && <CategoriesTab />}
      {tab === 'labels' && <MovementLabelsTab />}
      {tab === 'structure' && isAdmin && <StructureTab />}
      {tab === 'users' && isAdmin && <UsersTab />}
      {tab === 'currency' && isAdmin && <CurrencyTab />}
    </>
  );
}

/* ── Custom fields builder (docs/05_UIUX §4.8) ─────────────────────── */
function CustomFieldsTab() {
  const toast = useToast();
  const [fields, setFields] = useState<FieldDef[]>([]);
  const [categories, setCategories] = useState<Lookup[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState<Record<string, any>>({});
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<{ data: FieldDef[] }>('/custom-fields').then((r) => setFields(r.data));
    api<{ data: Lookup[] }>('/categories').then((r) => setCategories(r.data));
  }, []);
  useEffect(load, [load]);

  function open() {
    setError('');
    setForm({ label: '', key: '', type: 'text', category_id: '', is_required: false, help_text: '', options: '' });
    setShow(true);
  }

  async function save() {
    const needsOptions = form.type === 'select' || form.type === 'multiselect';
    const body: any = {
      label: form.label,
      key: form.key || form.label.toLowerCase().replace(/[^a-z0-9]+/g, '_'),
      type: form.type,
      category_id: form.category_id || null,
      is_required: form.is_required,
      help_text: form.help_text || null,
      options: needsOptions
        ? String(form.options).split(',').map((s: string) => s.trim()).filter(Boolean)
            .map((v: string) => ({ value: v, label: v }))
        : undefined,
    };
    try {
      await api('/custom-fields', { method: 'POST', body });
      toast('Field created');
      setShow(false);
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Save failed');
    }
  }

  async function remove(f: FieldDef) {
    if (!confirm(`Delete field "${f.label}"? Historical values are retained.`)) return;
    await api(`/custom-fields/${f.id}`, { method: 'DELETE' });
    toast('Field deleted');
    load();
  }

  const catName = (id: string | null) => categories.find((c) => c.id === id)?.name ?? 'All categories';

  return (
    <>
      <div style={{ marginBottom: 14 }}>
        <button className="btn" onClick={open}>+ Add field</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Label</th><th>Key</th><th>Type</th><th>Category</th><th>Required</th><th>Options</th><th /></tr></thead>
          <tbody>
            {fields.length === 0 ? (
              <tr><td colSpan={7} className="empty">No custom fields yet — add one to extend item forms.</td></tr>
            ) : fields.map((f) => (
              <tr key={f.id}>
                <td><strong>{f.label}</strong></td>
                <td><code>{f.key}</code></td>
                <td><span className="badge blue">{f.type}</span></td>
                <td>{catName(f.category_id)}</td>
                <td>{f.is_required ? 'Yes' : 'No'}</td>
                <td>{f.options?.map((o) => o.label).join(', ') || '—'}</td>
                <td><button className="btn ghost sm" onClick={() => remove(f)}>Delete</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <Modal title="Add custom field" onClose={() => setShow(false)}>
          <div className="form-row">
            <div className="field"><label>Label *</label>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Voltage" /></div>
            <div className="field"><label>Key (auto if blank)</label>
              <input value={form.key} onChange={(e) => setForm({ ...form, key: e.target.value })} placeholder="voltage" /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Type</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
                {['text', 'number', 'date', 'boolean', 'select', 'multiselect'].map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select></div>
            <div className="field"><label>Category</label>
              <select value={form.category_id} onChange={(e) => setForm({ ...form, category_id: e.target.value })}>
                <option value="">All categories</option>
                {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select></div>
          </div>
          {(form.type === 'select' || form.type === 'multiselect') && (
            <div className="field"><label>Options (comma-separated)</label>
              <input value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} placeholder="24V, 110V, 230V" /></div>
          )}
          <div className="field"><label>Help text</label>
            <input value={form.help_text} onChange={(e) => setForm({ ...form, help_text: e.target.value })} /></div>
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.is_required}
                onChange={(e) => setForm({ ...form, is_required: e.target.checked })} /> Required
            </label>
          </div>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn" disabled={!form.label} onClick={save}>Create field</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ── Categories ────────────────────────────────────────────────────── */
function CategoriesTab() {
  const toast = useToast();
  const [categories, setCategories] = useState<Lookup[]>([]);
  const [name, setName] = useState('');

  const load = useCallback(() => {
    api<{ data: Lookup[] }>('/categories').then((r) => setCategories(r.data));
  }, []);
  useEffect(load, [load]);

  async function add() {
    try {
      await api('/categories', { method: 'POST', body: { name } });
      setName('');
      toast('Category added');
      load();
    } catch (err: any) {
      toast(err.message ?? 'Failed', true);
    }
  }

  return (
    <>
      <div className="filters">
        <input placeholder="New category name…" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn" disabled={!name.trim()} onClick={add}>Add</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Name</th><th /></tr></thead>
          <tbody>
            {categories.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td>
                <td>
                  <button className="btn ghost sm" onClick={async () => {
                    if (!confirm(`Delete category "${c.name}"?`)) return;
                    await api(`/categories/${c.id}`, { method: 'DELETE' });
                    load();
                  }}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

/* ── Movement labels (admin + manager) ────────────────────────────── */
const BASE_TYPES = [
  { key: 'receipt', label: 'Receipt (stock in)' },
  { key: 'issue', label: 'Issue (stock out)' },
  { key: 'transfer', label: 'Transfer (between locations)' },
  { key: 'adjustment', label: 'Adjustment (+/-)' },
  { key: 'write_off', label: 'Write-off (stock out)' },
];

function MovementLabelsTab() {
  const toast = useToast();
  const { user, refreshUser } = useAuth();
  const [labels, setLabels] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ label: '', base_type: 'issue' });
  const [editing, setEditing] = useState<any | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [error, setError] = useState('');
  const [actionLabel, setActionLabel] = useState('');
  const [savingAction, setSavingAction] = useState(false);

  const load = useCallback(() => {
    api<{ data: any[] }>('/txn-labels').then((r) => setLabels(r.data));
  }, []);
  useEffect(load, [load]);

  // Inventory row action-button label lives in org settings (default "QTY").
  useEffect(() => {
    setActionLabel(user?.org_settings?.inventory_action_label ?? 'QTY');
  }, [user]);

  async function saveActionLabel() {
    const value = actionLabel.trim();
    if (!value) return;
    setSavingAction(true);
    try {
      await api('/org', { method: 'PATCH', body: { settings: { inventory_action_label: value } } });
      await refreshUser();
      toast('Inventory button label saved');
    } catch (err: any) {
      toast(err.message ?? 'Failed to save label', true);
    } finally {
      setSavingAction(false);
    }
  }

  async function add() {
    try {
      await api('/txn-labels', { method: 'POST', body: form });
      toast('Label added');
      setShow(false);
      setForm({ label: '', base_type: 'issue' });
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed');
    }
  }

  async function rename() {
    try {
      await api(`/txn-labels/${editing.id}`, { method: 'PATCH', body: { label: editLabel } });
      toast('Label renamed');
      setEditing(null);
      load();
    } catch (err: any) {
      toast(err.message ?? 'Failed', true);
    }
  }

  async function remove(l: any) {
    if (!confirm(`Remove the "${l.label}" label? Past movements keep their label.`)) return;
    try {
      await api(`/txn-labels/${l.id}`, { method: 'DELETE' });
      toast('Label removed');
      load();
    } catch (err: any) {
      toast(err.message ?? 'Failed', true);
    }
  }

  const baseLabel = (k: string) => BASE_TYPES.find((b) => b.key === k)?.label ?? k;

  return (
    <>
      {user?.is_org_admin && (
        <div style={{ marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
          <h3 style={{ margin: '0 0 4px' }}>Inventory action button</h3>
          <p style={{ color: 'var(--text-muted)', marginBottom: 10, maxWidth: 680 }}>
            Label for the per-row stock button on the Inventory table (the one that opens “Record movement”). Defaults to “QTY”.
          </p>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <input
              style={{ maxWidth: 220 }}
              value={actionLabel}
              maxLength={24}
              onChange={(e) => setActionLabel(e.target.value)}
              placeholder="QTY"
            />
            <button
              className="btn"
              disabled={savingAction || !actionLabel.trim() || actionLabel.trim() === (user?.org_settings?.inventory_action_label ?? 'QTY')}
              onClick={saveActionLabel}
            >
              Save
            </button>
          </div>
        </div>
      )}
      <p style={{ color: 'var(--text-muted)', marginBottom: 12, maxWidth: 680 }}>
        Rename the movement types your team sees (e.g. “Issue” → “Dispatch”) or add new ones.
        Each label maps to a built-in behaviour so stock maths stay correct.
      </p>
      <div style={{ marginBottom: 14 }}>
        <button className="btn" onClick={() => { setError(''); setShow(true); }}>+ Add label</button>
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Label</th><th>Behaviour</th><th /></tr></thead>
          <tbody>
            {labels.map((l) => (
              <tr key={l.id}>
                <td><strong>{l.label}</strong></td>
                <td><span className="badge gray">{baseLabel(l.base_type)}</span></td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  <button className="btn ghost sm" onClick={() => { setEditLabel(l.label); setEditing(l); }}>Rename</button>
                  <button className="btn ghost sm" onClick={() => remove(l)}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <Modal title="Add movement label" onClose={() => setShow(false)}>
          <div className="field"><label>Label name *</label>
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="e.g. Dispatch" autoFocus /></div>
          <div className="field"><label>Behaviour *</label>
            <select value={form.base_type} onChange={(e) => setForm({ ...form, base_type: e.target.value })}>
              {BASE_TYPES.map((b) => <option key={b.key} value={b.key}>{b.label}</option>)}
            </select>
            <div className="help-text">Determines how stock moves and which location fields appear.</div>
          </div>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn" disabled={!form.label.trim()} onClick={add}>Add label</button>
          </div>
        </Modal>
      )}

      {editing && (
        <Modal title={`Rename "${editing.label}"`} onClose={() => setEditing(null)}>
          <div className="field"><label>New name *</label>
            <input value={editLabel} onChange={(e) => setEditLabel(e.target.value)} autoFocus /></div>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn" disabled={!editLabel.trim()} onClick={rename}>Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ── Sites, projects, locations (org admin) ───────────────────────── */
function StructureTab() {
  const toast = useToast();
  const [sites, setSites] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [locations, setLocations] = useState<any[]>([]);
  const [siteForm, setSiteForm] = useState({ code: '', name: '' });
  const [projForm, setProjForm] = useState({ site_id: '', code: '', name: '' });
  const [locForm, setLocForm] = useState({ site_id: '', code: '' });

  const load = useCallback(() => {
    api<{ data: any[] }>('/sites').then((r) => setSites(r.data));
    api<{ data: any[] }>('/projects').then((r) => setProjects(r.data));
    api<{ data: any[] }>('/locations').then((r) => setLocations(r.data));
  }, []);
  useEffect(load, [load]);

  const post = (path: string, body: any, reset: () => void) =>
    api(path, { method: 'POST', body })
      .then(() => { toast('Created'); reset(); load(); })
      .catch((err) => toast(err.message ?? 'Failed', true));

  return (
    <div className="grid-2">
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Sites</h3>
        <div className="filters">
          <input placeholder="Code" value={siteForm.code} onChange={(e) => setSiteForm({ ...siteForm, code: e.target.value })} />
          <input placeholder="Name" value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })} />
          <button className="btn sm" disabled={!siteForm.code || !siteForm.name}
            onClick={() => post('/sites', siteForm, () => setSiteForm({ code: '', name: '' }))}>Add</button>
        </div>
        <table>
          <thead><tr><th>Code</th><th>Name</th></tr></thead>
          <tbody>{sites.map((s) => <tr key={s.id}><td>{s.code}</td><td>{s.name}</td></tr>)}</tbody>
        </table>

        <h3 style={{ margin: '20px 0 12px' }}>Locations</h3>
        <div className="filters">
          <select value={locForm.site_id} onChange={(e) => setLocForm({ ...locForm, site_id: e.target.value })}>
            <option value="">Site…</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
          </select>
          <input placeholder="Location code e.g. CNW L/L R2A" value={locForm.code}
            onChange={(e) => setLocForm({ ...locForm, code: e.target.value })} />
          <button className="btn sm" disabled={!locForm.site_id || !locForm.code}
            onClick={() => post('/locations', { ...locForm, name: locForm.code }, () => setLocForm({ site_id: '', code: '' }))}>Add</button>
        </div>
        <table>
          <thead><tr><th>Code</th><th>Site</th></tr></thead>
          <tbody>{locations.map((l) => <tr key={l.id}><td>{l.code}</td><td>{l.site_code}</td></tr>)}</tbody>
        </table>
      </div>

      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Projects</h3>
        <div className="filters">
          <select value={projForm.site_id} onChange={(e) => setProjForm({ ...projForm, site_id: e.target.value })}>
            <option value="">Site…</option>
            {sites.map((s) => <option key={s.id} value={s.id}>{s.code}</option>)}
          </select>
          <input placeholder="Code" value={projForm.code} onChange={(e) => setProjForm({ ...projForm, code: e.target.value })} />
          <input placeholder="Name" value={projForm.name} onChange={(e) => setProjForm({ ...projForm, name: e.target.value })} />
          <button className="btn sm" disabled={!projForm.site_id || !projForm.code || !projForm.name}
            onClick={() => post('/projects', projForm, () => setProjForm({ site_id: '', code: '', name: '' }))}>Add</button>
        </div>
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Site</th></tr></thead>
          <tbody>{projects.map((p) => <tr key={p.id}><td>{p.code}</td><td>{p.name}</td><td>{p.site_code}</td></tr>)}</tbody>
        </table>
        <ProjectMembers projects={projects} />
      </div>
    </div>
  );
}

function ProjectMembers({ projects }: { projects: any[] }) {
  const toast = useToast();
  const [projectId, setProjectId] = useState('');
  const [members, setMembers] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [userId, setUserId] = useState('');
  const [memberRole, setMemberRole] = useState('technician');

  useEffect(() => {
    api<{ data: any[] }>('/users').then((r) => setUsers(r.data)).catch(() => {});
  }, []);
  const loadMembers = useCallback(() => {
    if (!projectId) return setMembers([]);
    api<{ data: any[] }>(`/projects/${projectId}/members`).then((r) => setMembers(r.data));
  }, [projectId]);
  useEffect(loadMembers, [loadMembers]);

  async function add() {
    try {
      await api(`/projects/${projectId}/members`, { method: 'POST', body: { user_id: userId, role: memberRole } });
      toast('Member added');
      loadMembers();
    } catch (err: any) {
      toast(err.message ?? 'Failed', true);
    }
  }

  return (
    <>
      <h3 style={{ margin: '20px 0 12px' }}>Project members</h3>
      <div className="filters">
        <select value={projectId} onChange={(e) => setProjectId(e.target.value)}>
          <option value="">Project…</option>
          {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select value={userId} onChange={(e) => setUserId(e.target.value)}>
          <option value="">User…</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
        </select>
        <select value={memberRole} onChange={(e) => setMemberRole(e.target.value)}>
          {['viewer', 'technician', 'manager'].map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <button className="btn sm" disabled={!projectId || !userId} onClick={add}>Assign</button>
      </div>
      {projectId && (
        <table>
          <thead><tr><th>User</th><th>Role</th><th /></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id}>
                <td>{m.full_name}</td>
                <td><span className="badge blue">{m.role}</span></td>
                <td>
                  <button className="btn ghost sm" onClick={async () => {
                    await api(`/projects/${projectId}/members/${m.user_id}`, { method: 'DELETE' });
                    loadMembers();
                  }}>Remove</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  );
}

/* ── Users (org admin) ────────────────────────────────────────────── */
function UsersTab() {
  const toast = useToast();
  const [users, setUsers] = useState<any[]>([]);
  const [show, setShow] = useState(false);
  const [form, setForm] = useState({ username: '', email: '', full_name: '', password: '', is_org_admin: false });
  const [error, setError] = useState('');
  const [resetUser, setResetUser] = useState<any | null>(null);
  const [resetPw, setResetPw] = useState('');
  const [editUser, setEditUser] = useState<any | null>(null);
  const [editForm, setEditForm] = useState({ username: '', email: '', full_name: '', is_org_admin: false });
  const [editError, setEditError] = useState('');

  function openEdit(u: any) {
    setEditError('');
    setEditForm({ username: u.username, email: u.email ?? '', full_name: u.full_name, is_org_admin: !!u.is_org_admin });
    setEditUser(u);
  }

  async function saveEdit() {
    if (!editForm.username || !editForm.full_name) return;
    try {
      await api(`/users/${editUser.id}`, {
        method: 'PATCH',
        body: {
          username: editForm.username,
          full_name: editForm.full_name,
          email: editForm.email || null,
          is_org_admin: editForm.is_org_admin,
        },
      });
      toast(`${editForm.full_name}'s profile updated`);
      setEditUser(null);
      load();
    } catch (err: any) {
      setEditError(err instanceof ApiRequestError ? err.message : (err.message ?? 'Update failed'));
    }
  }

  const load = useCallback(() => {
    api<{ data: any[] }>('/users').then((r) => setUsers(r.data));
  }, []);
  useEffect(load, [load]);

  async function doReset() {
    if (resetPw.length < 8) return;
    try {
      await api(`/users/${resetUser.id}`, { method: 'PATCH', body: { password: resetPw } });
      toast(`Password reset for ${resetUser.username} — their sessions were signed out`);
      setResetUser(null);
      setResetPw('');
    } catch (err: any) {
      toast(err.message ?? 'Reset failed', true);
    }
  }

  async function decide(u: any, action: 'approve' | 'reject') {
    if (action === 'reject' && !confirm(`Reject ${u.username}'s registration? They will not be able to sign in.`)) return;
    try {
      await api(`/users/${u.id}/${action}`, { method: 'POST' });
      toast(`${u.username} ${action === 'approve' ? 'approved' : 'rejected'}`);
      load();
    } catch (err: any) {
      toast(err.message ?? 'Failed', true);
    }
  }

  const pendingCount = users.filter((u) => u.approval_status === 'pending').length;

  async function save() {
    try {
      await api('/users', { method: 'POST', body: { ...form, email: form.email || null } });
      toast('User created');
      setShow(false);
      setForm({ username: '', email: '', full_name: '', password: '', is_org_admin: false });
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed');
    }
  }

  return (
    <>
      <div style={{ marginBottom: 14, display: 'flex', gap: 12, alignItems: 'center' }}>
        <button className="btn" onClick={() => { setError(''); setShow(true); }}>+ New user</button>
        {pendingCount > 0 && (
          <span className="badge amber">{pendingCount} pending approval</span>
        )}
      </div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>Username</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th><th>Memberships</th><th /></tr></thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td><strong>{u.username}</strong></td>
                <td>{u.full_name}</td>
                <td>{u.email ?? '—'}</td>
                <td>{u.is_org_admin ? <span className="badge blue">admin</span> : '—'}</td>
                <td>
                  {u.approval_status === 'pending' ? <span className="badge amber">pending</span>
                    : u.approval_status === 'rejected' ? <span className="badge red">rejected</span>
                    : u.is_active ? <span className="badge green">active</span>
                    : <span className="badge gray">inactive</span>}
                  {u.self_registered && <span className="badge gray" style={{ marginLeft: 4 }}>self-reg</span>}
                </td>
                <td>{u.memberships.map((m: any) => `${m.project_name}: ${m.role}`).join(', ') || '—'}</td>
                <td style={{ whiteSpace: 'nowrap' }}>
                  {u.approval_status === 'pending' ? (
                    <>
                      <button className="btn ghost sm" onClick={() => decide(u, 'approve')}>Approve</button>
                      <button className="btn ghost sm" onClick={() => decide(u, 'reject')}>Reject</button>
                    </>
                  ) : (
                    <>
                      <button className="btn ghost sm" onClick={() => openEdit(u)}>Edit</button>
                      <button className="btn ghost sm" onClick={() => { setResetPw(''); setResetUser(u); }}>
                        Reset password
                      </button>
                      {u.is_active ? (
                        <button className="btn ghost sm" onClick={async () => {
                          if (!confirm(`Deactivate ${u.full_name}?`)) return;
                          await api(`/users/${u.id}`, { method: 'DELETE' });
                          load();
                        }}>Deactivate</button>
                      ) : u.approval_status !== 'rejected' && (
                        <button className="btn ghost sm" onClick={async () => {
                          try {
                            await api(`/users/${u.id}`, { method: 'PATCH', body: { is_active: true } });
                            toast(`${u.full_name} reactivated`);
                            load();
                          } catch (err: any) {
                            toast(err.message ?? 'Failed', true);
                          }
                        }}>Activate</button>
                      )}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {show && (
        <Modal title="New user" onClose={() => setShow(false)}>
          <div className="field"><label>Username * (login name)</label>
            <input value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
          <div className="field"><label>Full name *</label>
            <input value={form.full_name} onChange={(e) => setForm({ ...form, full_name: e.target.value })} /></div>
          <div className="field"><label>Email (optional)</label>
            <input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          <div className="field"><label>Password * (min 8 chars)</label>
            <input type="password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={form.is_org_admin}
                onChange={(e) => setForm({ ...form, is_org_admin: e.target.checked })} /> Organization admin
            </label>
          </div>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setShow(false)}>Cancel</button>
            <button className="btn" disabled={!form.username || !form.full_name || form.password.length < 8} onClick={save}>Create</button>
          </div>
        </Modal>
      )}

      {editUser && (
        <Modal title={`Edit profile — ${editUser.username}`} onClose={() => setEditUser(null)}>
          <div className="field"><label>Username * (login name)</label>
            <input value={editForm.username} onChange={(e) => setEditForm({ ...editForm, username: e.target.value })} autoFocus /></div>
          <div className="field"><label>Full name *</label>
            <input value={editForm.full_name} onChange={(e) => setEditForm({ ...editForm, full_name: e.target.value })} /></div>
          <div className="field"><label>Email (optional)</label>
            <input type="email" value={editForm.email} onChange={(e) => setEditForm({ ...editForm, email: e.target.value })} /></div>
          <div className="field">
            <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <input type="checkbox" style={{ width: 'auto' }} checked={editForm.is_org_admin}
                onChange={(e) => setEditForm({ ...editForm, is_org_admin: e.target.checked })} /> Organization admin
            </label>
          </div>
          <p style={{ color: 'var(--text-muted)', fontSize: 13 }}>Use “Reset password” to change this user’s password.</p>
          {editError && <div className="error-text">{editError}</div>}
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setEditUser(null)}>Cancel</button>
            <button className="btn" disabled={!editForm.username || !editForm.full_name} onClick={saveEdit}>Save</button>
          </div>
        </Modal>
      )}

      {resetUser && (
        <Modal title={`Reset password — ${resetUser.username}`} onClose={() => setResetUser(null)}>
          <p style={{ marginBottom: 14, color: 'var(--text-muted)' }}>
            Set a new password for <strong>{resetUser.full_name}</strong>. Their active sessions will be signed out.
          </p>
          <div className="field">
            <label>New password (min 8 chars)</label>
            <input type="text" value={resetPw} onChange={(e) => setResetPw(e.target.value)} autoFocus
              placeholder="Share this with the user securely" />
          </div>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setResetUser(null)}>Cancel</button>
            <button className="btn" disabled={resetPw.length < 8} onClick={doReset}>Reset password</button>
          </div>
        </Modal>
      )}
    </>
  );
}

/* ── Currencies & exchange rates (org admin) ──────────────────────── */
function CurrencyTab() {
  const toast = useToast();
  const [currencies, setCurrencies] = useState<any[]>([]);
  const [rates, setRates] = useState<any[]>([]);
  const [rateForm, setRateForm] = useState({ from_currency: '', to_currency: 'USD', rate: '', effective_date: new Date().toISOString().slice(0, 10) });

  const load = useCallback(() => {
    api<{ data: any[] }>('/currencies').then((r) => setCurrencies(r.data));
    api<{ data: any[] }>('/exchange-rates').then((r) => setRates(r.data));
  }, []);
  useEffect(load, [load]);

  async function addRate() {
    try {
      await api('/exchange-rates', {
        method: 'POST',
        body: { ...rateForm, rate: Number(rateForm.rate) },
      });
      toast('Rate saved');
      setRateForm({ ...rateForm, rate: '' });
      load();
    } catch (err: any) {
      toast(err.message ?? 'Failed', true);
    }
  }

  return (
    <div className="grid-2">
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Currencies</h3>
        <table>
          <thead><tr><th>Code</th><th>Name</th><th>Symbol</th></tr></thead>
          <tbody>
            {currencies.map((c) => (
              <tr key={c.code}><td>{c.code}</td><td>{c.name}</td><td>{c.symbol ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="card">
        <h3 style={{ marginBottom: 12 }}>Exchange rates (effective-dated)</h3>
        <div className="filters">
          <select value={rateForm.from_currency} onChange={(e) => setRateForm({ ...rateForm, from_currency: e.target.value })}>
            <option value="">From…</option>
            {currencies.map((c) => <option key={c.code} value={c.code.trim()}>{c.code}</option>)}
          </select>
          <select value={rateForm.to_currency} onChange={(e) => setRateForm({ ...rateForm, to_currency: e.target.value })}>
            {currencies.map((c) => <option key={c.code} value={c.code.trim()}>{c.code}</option>)}
          </select>
          <input type="number" step="any" placeholder="Rate" value={rateForm.rate}
            onChange={(e) => setRateForm({ ...rateForm, rate: e.target.value })} />
          <input type="date" value={rateForm.effective_date}
            onChange={(e) => setRateForm({ ...rateForm, effective_date: e.target.value })} />
          <button className="btn sm" disabled={!rateForm.from_currency || !rateForm.rate} onClick={addRate}>Set</button>
        </div>
        <table>
          <thead><tr><th>From</th><th>To</th><th className="num">Rate</th><th>Effective</th></tr></thead>
          <tbody>
            {rates.map((r) => (
              <tr key={r.id}>
                <td>{r.from_currency}</td><td>{r.to_currency}</td>
                <td className="num">{r.rate}</td><td>{r.effective_date?.slice(0, 10)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
