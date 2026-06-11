import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api';
import { useAuth, isManager } from '../auth';
import { Modal, useToast } from '../components/ui';

interface Supplier {
  id: string;
  name: string;
  contact_name: string | null;
  email: string | null;
  phone: string | null;
  lead_time_days: number | null;
  currency: string | null;
}

export default function Suppliers() {
  const { role } = useAuth();
  const toast = useToast();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [editing, setEditing] = useState<Supplier | null | 'new'>(null);
  const [form, setForm] = useState<Record<string, any>>({});
  const [error, setError] = useState('');

  const load = useCallback(() => {
    api<{ data: Supplier[] }>('/suppliers').then((r) => setSuppliers(r.data));
  }, []);
  useEffect(load, [load]);

  function open(s: Supplier | 'new') {
    setError('');
    setForm(
      s === 'new'
        ? { name: '', contact_name: '', email: '', phone: '', lead_time_days: '', currency: '' }
        : { ...s, lead_time_days: s.lead_time_days ?? '', currency: s.currency?.trim() ?? '' }
    );
    setEditing(s);
  }

  async function save() {
    const body = {
      name: form.name,
      contact_name: form.contact_name || null,
      email: form.email || null,
      phone: form.phone || null,
      lead_time_days: form.lead_time_days === '' ? null : Number(form.lead_time_days),
      currency: form.currency || null,
    };
    try {
      if (editing === 'new') await api('/suppliers', { method: 'POST', body });
      else await api(`/suppliers/${(editing as Supplier).id}`, { method: 'PATCH', body });
      toast('Supplier saved');
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Save failed');
    }
  }

  return (
    <>
      <div className="page-head">
        <h2>Suppliers</h2>
        {isManager(role) && <button className="btn" onClick={() => open('new')}>+ New supplier</button>}
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Name</th><th>Contact</th><th>Email</th><th>Phone</th><th className="num">Lead time</th><th>Currency</th>{isManager(role) && <th />}</tr>
          </thead>
          <tbody>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <td><strong>{s.name}</strong></td>
                <td>{s.contact_name ?? '—'}</td>
                <td>{s.email ?? '—'}</td>
                <td>{s.phone ?? '—'}</td>
                <td className="num">{s.lead_time_days ? `${s.lead_time_days}d` : '—'}</td>
                <td>{s.currency ?? '—'}</td>
                {isManager(role) && (
                  <td><button className="btn ghost sm" onClick={() => open(s)}>Edit</button></td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {editing && (
        <Modal title={editing === 'new' ? 'New supplier' : `Edit ${(editing as Supplier).name}`} onClose={() => setEditing(null)}>
          <div className="field"><label>Name *</label>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="form-row">
            <div className="field"><label>Contact</label>
              <input value={form.contact_name ?? ''} onChange={(e) => setForm({ ...form, contact_name: e.target.value })} /></div>
            <div className="field"><label>Email</label>
              <input value={form.email ?? ''} onChange={(e) => setForm({ ...form, email: e.target.value })} /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Phone</label>
              <input value={form.phone ?? ''} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></div>
            <div className="field"><label>Lead time (days)</label>
              <input type="number" value={form.lead_time_days} onChange={(e) => setForm({ ...form, lead_time_days: e.target.value })} /></div>
          </div>
          <div className="field"><label>Currency (3-letter code)</label>
            <input maxLength={3} value={form.currency ?? ''} onChange={(e) => setForm({ ...form, currency: e.target.value.toUpperCase() })} /></div>
          {error && <div className="error-text">{error}</div>}
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setEditing(null)}>Cancel</button>
            <button className="btn" disabled={!form.name} onClick={save}>Save</button>
          </div>
        </Modal>
      )}
    </>
  );
}
