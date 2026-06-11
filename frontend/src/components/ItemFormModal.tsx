import { useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api';
import type { FieldDef, Item, Lookup } from '../types';
import { Modal, useToast } from './ui';

interface Props {
  item?: Item | null; // undefined = create
  onClose: () => void;
  onSaved: () => void;
}

export default function ItemFormModal({ item, onClose, onSaved }: Props) {
  const toast = useToast();
  const editing = !!item;
  const [form, setForm] = useState<Record<string, any>>({
    item_no: item?.item_no ?? '',
    description: item?.description ?? '',
    specification: item?.specification ?? '',
    model: item?.model ?? '',
    supplier_id: item?.supplier?.id ?? '',
    category_id: item?.category?.id ?? '',
    department: item?.department ?? '',
    default_location_id: item?.default_location?.id ?? '',
    unit_price: item?.unit_price ?? '',
    currency: item?.currency?.trim() ?? 'USD',
    reorder_level: item?.reorder_level ?? 0,
    max_level: item?.max_level ?? '',
    comments: item?.comments ?? '',
  });
  const [custom, setCustom] = useState<Record<string, any>>(item?.custom ?? {});
  const [defs, setDefs] = useState<FieldDef[]>([]);
  const [suppliers, setSuppliers] = useState<Lookup[]>([]);
  const [categories, setCategories] = useState<Lookup[]>([]);
  const [locations, setLocations] = useState<Lookup[]>([]);
  const [currencies, setCurrencies] = useState<{ code: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ data: Lookup[] }>('/suppliers').then((r) => setSuppliers(r.data));
    api<{ data: Lookup[] }>('/categories').then((r) => setCategories(r.data));
    api<{ data: Lookup[] }>('/locations').then((r) => setLocations(r.data));
    api<{ data: { code: string }[] }>('/currencies').then((r) => setCurrencies(r.data));
  }, []);

  // FR-4.2: custom fields render from the selected category's definitions
  useEffect(() => {
    const url = form.category_id ? `/custom-fields?category_id=${form.category_id}` : '/custom-fields';
    api<{ data: FieldDef[] }>(url).then((r) =>
      setDefs(r.data.filter((d) => !form.category_id || d.category_id === form.category_id || d.category_id === null))
    );
  }, [form.category_id]);

  const set = (key: string, value: any) => setForm((f) => ({ ...f, [key]: value }));

  async function submit() {
    setSaving(true);
    setError('');
    const body: Record<string, any> = {
      ...form,
      supplier_id: form.supplier_id || null,
      category_id: form.category_id || null,
      default_location_id: form.default_location_id || null,
      unit_price: form.unit_price === '' ? null : Number(form.unit_price),
      reorder_level: Number(form.reorder_level) || 0,
      max_level: form.max_level === '' ? null : Number(form.max_level),
      specification: form.specification || null,
      model: form.model || null,
      department: form.department || null,
      comments: form.comments || null,
      currency: form.currency || null,
      custom,
    };
    try {
      if (editing) {
        const { item_no, ...rest } = body;
        await api(`/items/${item!.id}`, { method: 'PATCH', body: rest });
        toast('Item updated');
      } else {
        await api('/items', { method: 'POST', body });
        toast('Item created');
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function customInput(def: FieldDef) {
    const value = custom[def.key] ?? '';
    const setVal = (v: any) => setCustom((c) => ({ ...c, [def.key]: v }));
    switch (def.type) {
      case 'select':
        return (
          <select value={value} onChange={(e) => setVal(e.target.value)}>
            <option value="">—</option>
            {def.options.map((o) => (
              <option key={o.value} value={o.value}>{o.label}</option>
            ))}
          </select>
        );
      case 'boolean':
        return (
          <select value={String(value)} onChange={(e) => setVal(e.target.value === 'true')}>
            <option value="">—</option>
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        );
      case 'number':
        return <input type="number" step="any" value={value} onChange={(e) => setVal(e.target.value === '' ? '' : Number(e.target.value))} />;
      case 'date':
        return <input type="date" value={value} onChange={(e) => setVal(e.target.value)} />;
      default:
        return <input value={value} onChange={(e) => setVal(e.target.value)} />;
    }
  }

  return (
    <Modal title={editing ? `Edit ${item!.item_no}` : 'New item'} onClose={onClose} wide>
      <div className="form-row">
        <div className="field">
          <label>Item No *</label>
          <input value={form.item_no} disabled={editing} onChange={(e) => set('item_no', e.target.value)} />
        </div>
        <div className="field">
          <label>Description *</label>
          <input value={form.description} onChange={(e) => set('description', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Specification</label>
          <input value={form.specification} onChange={(e) => set('specification', e.target.value)} />
        </div>
        <div className="field">
          <label>Model</label>
          <input value={form.model} onChange={(e) => set('model', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Category</label>
          <select value={form.category_id} onChange={(e) => set('category_id', e.target.value)}>
            <option value="">—</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Supplier</label>
          <select value={form.supplier_id} onChange={(e) => set('supplier_id', e.target.value)}>
            <option value="">—</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Default location</label>
          <select value={form.default_location_id} onChange={(e) => set('default_location_id', e.target.value)}>
            <option value="">—</option>
            {locations.map((l) => (
              <option key={l.id} value={l.id}>{l.code}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Department</label>
          <input value={form.department} onChange={(e) => set('department', e.target.value)} />
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Unit price</label>
          <input type="number" step="any" value={form.unit_price} onChange={(e) => set('unit_price', e.target.value)} />
        </div>
        <div className="field">
          <label>Currency</label>
          <select value={form.currency} onChange={(e) => set('currency', e.target.value)}>
            {currencies.map((c) => (
              <option key={c.code} value={c.code.trim()}>{c.code}</option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="field">
          <label>Reorder level</label>
          <input type="number" step="any" value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} />
        </div>
        <div className="field">
          <label>Max level</label>
          <input type="number" step="any" value={form.max_level} onChange={(e) => set('max_level', e.target.value)} />
        </div>
      </div>

      {defs.length > 0 && (
        <>
          <h3 style={{ fontSize: 15, margin: '8px 0 12px' }}>Custom fields</h3>
          <div className="form-row">
            {defs.map((d) => (
              <div className="field" key={d.id}>
                <label>{d.label}{d.is_required ? ' *' : ''}</label>
                {customInput(d)}
                {d.help_text && <div className="help-text">{d.help_text}</div>}
              </div>
            ))}
          </div>
        </>
      )}

      <div className="field">
        <label>Comments</label>
        <textarea rows={2} value={form.comments} onChange={(e) => set('comments', e.target.value)} />
      </div>

      {error && <div className="error-text">{error}</div>}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={saving || !form.item_no || !form.description} onClick={submit}>
          {saving ? 'Saving…' : editing ? 'Save changes' : 'Create item'}
        </button>
      </div>
    </Modal>
  );
}
