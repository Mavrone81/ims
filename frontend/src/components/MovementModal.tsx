import { useEffect, useMemo, useState } from 'react';
import { api, ApiRequestError } from '../api';
import type { Item, Lookup } from '../types';
import { Modal, useToast } from './ui';

type TxnType = 'receipt' | 'issue' | 'transfer' | 'adjustment' | 'write_off';
const TYPES: { key: TxnType; label: string }[] = [
  { key: 'receipt', label: 'Receipt' },
  { key: 'issue', label: 'Issue' },
  { key: 'transfer', label: 'Transfer' },
  { key: 'adjustment', label: 'Adjust' },
  { key: 'write_off', label: 'Write-off' },
];

interface Props {
  item: Item;
  initialType?: TxnType;
  onClose: () => void;
  onSaved: () => void;
}

/** Single type-switching movement form (docs/05_UIUX §4.4). */
export default function MovementModal({ item, initialType = 'issue', onClose, onSaved }: Props) {
  const toast = useToast();
  const [type, setType] = useState<TxnType>(initialType);
  const [qty, setQty] = useState(1);
  const [fromLoc, setFromLoc] = useState('');
  const [toLoc, setToLoc] = useState('');
  const [purpose, setPurpose] = useState('');
  const [reference, setReference] = useState('');
  const [locations, setLocations] = useState<Lookup[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ data: Lookup[] }>('/locations').then((r) => setLocations(r.data));
  }, []);

  useEffect(() => {
    const def = item.default_location?.id ?? '';
    setFromLoc(def);
    setToLoc(type === 'transfer' ? '' : def);
  }, [type, item]);

  const needsFrom = type === 'issue' || type === 'write_off' || type === 'transfer';
  const needsTo = type === 'receipt' || type === 'transfer' || type === 'adjustment';

  const newBalance = useMemo(() => {
    const delta =
      type === 'receipt' ? qty :
      type === 'adjustment' ? qty :
      type === 'transfer' ? 0 : -qty;
    return item.stock_on_hand + delta;
  }, [type, qty, item.stock_on_hand]);

  async function submit() {
    setSaving(true);
    setError('');
    try {
      await api('/transactions', {
        method: 'POST',
        body: {
          type,
          item_id: item.id,
          quantity: qty,
          from_location_id: needsFrom ? fromLoc || null : null,
          to_location_id: needsTo ? toLoc || null : null,
          purpose: purpose || null,
          reference: reference || null,
        },
      });
      toast(`${TYPES.find((t) => t.key === type)?.label} recorded — on-hand ${item.stock_on_hand} → ${newBalance}`);
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Failed to record movement');
    } finally {
      setSaving(false);
    }
  }

  const locSelect = (value: string, set: (v: string) => void, label: string) => (
    <div className="field">
      <label>{label}</label>
      <select value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Select location…</option>
        {locations.map((l) => (
          <option key={l.id} value={l.id}>{l.code}</option>
        ))}
      </select>
    </div>
  );

  return (
    <Modal title="Record movement" onClose={onClose}>
      <div className="type-tabs">
        {TYPES.map((t) => (
          <button key={t.key} className={type === t.key ? 'active' : ''} onClick={() => setType(t.key)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="balance-preview">
        {item.item_no} · {item.description} — on-hand <strong>{item.stock_on_hand}</strong>
        {type !== 'transfer' && <> → <strong>{newBalance}</strong></>}
      </div>

      <div className="field">
        <label>Quantity{type === 'adjustment' ? ' (use negative to decrease)' : ''}</label>
        <input
          type="number"
          value={qty}
          step="any"
          onChange={(e) => setQty(Number(e.target.value))}
        />
      </div>

      {needsFrom && locSelect(fromLoc, setFromLoc, 'From location')}
      {needsTo && locSelect(toLoc, setToLoc, type === 'adjustment' ? 'Location' : 'To location')}

      <div className="field">
        <label>Purpose</label>
        <input value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder="e.g. Replaced on CM8G blower" />
      </div>
      <div className="field">
        <label>Reference (WO / PO)</label>
        <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="WO-8842" />
      </div>

      {error && <div className="error-text">{error}</div>}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button
          className="btn"
          disabled={saving || qty === 0 || (needsFrom && !fromLoc) || (needsTo && !toLoc)}
          onClick={submit}
        >
          {saving ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </Modal>
  );
}
