import { useEffect, useMemo, useState } from 'react';
import { api, ApiRequestError } from '../api';
import type { Item, Lookup, TxnLabel } from '../types';
import { Modal, useToast } from './ui';

type BaseType = 'receipt' | 'issue' | 'transfer' | 'adjustment' | 'write_off';

interface Props {
  item: Item;
  onClose: () => void;
  onSaved: () => void;
}

/** Type-switching movement form driven by the org's custom labels (docs/05_UIUX §4.4). */
export default function MovementModal({ item, onClose, onSaved }: Props) {
  const toast = useToast();
  const [labels, setLabels] = useState<TxnLabel[]>([]);
  const [labelId, setLabelId] = useState('');
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
    api<{ data: TxnLabel[] }>('/txn-labels').then((r) => {
      setLabels(r.data);
      // default to the first "issue"-behaviour label, else the first label
      const def = r.data.find((l) => l.base_type === 'issue') ?? r.data[0];
      if (def) setLabelId(def.id);
    });
  }, []);

  const selected = labels.find((l) => l.id === labelId);
  const baseType: BaseType | undefined = selected?.base_type;

  useEffect(() => {
    const def = item.default_location?.id ?? '';
    setFromLoc(def);
    setToLoc(baseType === 'transfer' ? '' : def);
  }, [baseType, item]);

  const needsFrom = baseType === 'issue' || baseType === 'write_off' || baseType === 'transfer';
  const needsTo = baseType === 'receipt' || baseType === 'transfer' || baseType === 'adjustment';

  const newBalance = useMemo(() => {
    const delta =
      baseType === 'receipt' ? qty :
      baseType === 'adjustment' ? qty :
      baseType === 'transfer' ? 0 : -qty;
    return item.stock_on_hand + delta;
  }, [baseType, qty, item.stock_on_hand]);

  async function submit() {
    setSaving(true);
    setError('');
    try {
      await api('/transactions', {
        method: 'POST',
        body: {
          label_id: labelId,
          item_id: item.id,
          quantity: qty,
          from_location_id: needsFrom ? fromLoc || null : null,
          to_location_id: needsTo ? toLoc || null : null,
          purpose: purpose || null,
          reference: reference || null,
        },
      });
      toast(`${selected?.label ?? 'Movement'} recorded — on-hand ${item.stock_on_hand} → ${newBalance}`);
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
        {labels.map((l) => (
          <button key={l.id} className={labelId === l.id ? 'active' : ''} onClick={() => setLabelId(l.id)}>
            {l.label}
          </button>
        ))}
      </div>

      <div className="balance-preview">
        {item.item_no} · {item.description} — on-hand <strong>{item.stock_on_hand}</strong>
        {baseType !== 'transfer' && <> → <strong>{newBalance}</strong></>}
      </div>

      <div className="field">
        <label>Quantity{baseType === 'adjustment' ? ' (use negative to decrease)' : ''}</label>
        <input type="number" value={qty} step="any" onChange={(e) => setQty(Number(e.target.value))} />
      </div>

      {needsFrom && locSelect(fromLoc, setFromLoc, 'From location')}
      {needsTo && locSelect(toLoc, setToLoc, baseType === 'adjustment' ? 'Location' : 'To location')}

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
          disabled={saving || !labelId || qty === 0 || (needsFrom && !fromLoc) || (needsTo && !toLoc)}
          onClick={submit}
        >
          {saving ? 'Saving…' : 'Confirm'}
        </button>
      </div>
    </Modal>
  );
}
