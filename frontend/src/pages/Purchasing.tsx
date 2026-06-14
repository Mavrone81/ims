import { useCallback, useEffect, useState } from 'react';
import { api, ApiRequestError } from '../api';
import { useAuth, canWrite } from '../auth';
import { Modal, useToast, fmtMoney, fmtDate } from '../components/ui';
import type { Lookup, Paginated } from '../types';

interface PoLine {
  id: string;
  item_id: string;
  item_no: string;
  description: string;
  qty_ordered: number;
  qty_received: number;
  unit_price: number | null;
}
interface Po {
  id: string;
  po_number: string;
  status: 'draft' | 'ordered' | 'partial' | 'received' | 'cancelled';
  currency: string | null;
  ordered_at: string | null;
  expected_at: string | null;
  supplier_id: string;
  supplier_name: string;
  line_count?: number;
  total_value?: number;
  lines?: PoLine[];
}
interface ItemOption { id: string; item_no: string; description: string; unit_price: number | null; currency: string | null }

const STATUS_COLOR: Record<Po['status'], string> = {
  draft: 'gray', ordered: 'blue', partial: 'amber', received: 'green', cancelled: 'red',
};
function StatusPill({ status }: { status: Po['status'] }) {
  return <span className={`badge ${STATUS_COLOR[status]}`}>{status}</span>;
}

export default function Purchasing() {
  const { role } = useAuth();
  const toast = useToast();
  const writable = canWrite(role);
  const [pos, setPos] = useState<Po[]>([]);
  const [statusFilter, setStatusFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [detail, setDetail] = useState<Po | null>(null);
  const [receiving, setReceiving] = useState<Po | null>(null);

  // Lookups for the create/receive forms.
  const [suppliers, setSuppliers] = useState<Lookup[]>([]);
  const [items, setItems] = useState<ItemOption[]>([]);
  const [locations, setLocations] = useState<Lookup[]>([]);

  const load = useCallback(() => {
    const qs = statusFilter ? `?status=${statusFilter}` : '';
    api<Paginated<Po>>(`/purchase-orders${qs}`).then((r) => setPos(r.data));
  }, [statusFilter]);
  useEffect(load, [load]);

  useEffect(() => {
    api<{ data: Lookup[] }>('/suppliers').then((r) => setSuppliers(r.data)).catch(() => {});
    api<{ data: Lookup[] }>('/locations').then((r) => setLocations(r.data)).catch(() => {});
    api<Paginated<ItemOption>>('/items?page_size=200').then((r) => setItems(r.data)).catch(() => {});
  }, []);

  async function openDetail(po: Po) {
    const full = await api<Po>(`/purchase-orders/${po.id}`);
    setDetail(full);
  }
  async function openReceive(po: Po) {
    const full = await api<Po>(`/purchase-orders/${po.id}`);
    setReceiving(full);
  }

  return (
    <>
      <div className="page-head">
        <h2>Purchasing</h2>
        <div className="filters">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Status filter">
            <option value="">All statuses</option>
            {['draft', 'ordered', 'partial', 'received', 'cancelled'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          {writable && <button className="btn" onClick={() => setCreating(true)}>+ New PO</button>}
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>PO number</th><th>Supplier</th><th>Status</th>
              <th className="num">Lines</th><th className="num">Value</th><th>Expected</th><th />
            </tr>
          </thead>
          <tbody>
            {pos.length === 0 && (
              <tr><td colSpan={7} className="empty">No purchase orders yet.</td></tr>
            )}
            {pos.map((po) => (
              <tr key={po.id} className="row-link" onClick={() => openDetail(po)}>
                <td><strong>{po.po_number}</strong></td>
                <td>{po.supplier_name}</td>
                <td><StatusPill status={po.status} /></td>
                <td className="num">{po.line_count ?? '—'}</td>
                <td className="num">{fmtMoney(po.total_value, po.currency)}</td>
                <td>{po.expected_at ? fmtDate(po.expected_at) : '—'}</td>
                <td>
                  {writable && po.status !== 'received' && po.status !== 'cancelled' && (
                    <button className="btn ghost sm" onClick={(e) => { e.stopPropagation(); openReceive(po); }}>Receive</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {creating && (
        <CreatePoModal
          suppliers={suppliers}
          items={items}
          onClose={() => setCreating(false)}
          onSaved={() => { setCreating(false); toast('Purchase order created'); load(); }}
        />
      )}
      {detail && <PoDetailModal po={detail} onClose={() => setDetail(null)} />}
      {receiving && (
        <ReceiveModal
          po={receiving}
          locations={locations}
          onClose={() => setReceiving(null)}
          onReceived={() => { setReceiving(null); toast('Stock received'); load(); }}
        />
      )}
    </>
  );
}

function CreatePoModal({ suppliers, items, onClose, onSaved }: {
  suppliers: Lookup[]; items: ItemOption[]; onClose: () => void; onSaved: () => void;
}) {
  const [supplierId, setSupplierId] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [currency, setCurrency] = useState('');
  const [expectedAt, setExpectedAt] = useState('');
  const [lines, setLines] = useState<{ item_id: string; qty_ordered: string; unit_price: string }[]>([
    { item_id: '', qty_ordered: '1', unit_price: '' },
  ]);
  const [error, setError] = useState('');

  const setLine = (i: number, patch: Partial<(typeof lines)[number]>) =>
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));

  async function save() {
    const payloadLines = lines
      .filter((l) => l.item_id && Number(l.qty_ordered) > 0)
      .map((l) => ({
        item_id: l.item_id,
        qty_ordered: Number(l.qty_ordered),
        unit_price: l.unit_price === '' ? null : Number(l.unit_price),
      }));
    if (!payloadLines.length) { setError('Add at least one line with an item and quantity'); return; }
    try {
      await api('/purchase-orders', {
        method: 'POST',
        body: {
          supplier_id: supplierId,
          po_number: poNumber,
          currency: currency || null,
          expected_at: expectedAt || null,
          lines: payloadLines,
        },
      });
      onSaved();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Save failed');
    }
  }

  return (
    <Modal title="New purchase order" onClose={onClose} wide>
      <div className="form-row">
        <div className="field"><label>Supplier *</label>
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">Select…</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
        <div className="field"><label>PO number *</label>
          <input value={poNumber} onChange={(e) => setPoNumber(e.target.value)} /></div>
      </div>
      <div className="form-row">
        <div className="field"><label>Currency</label>
          <input maxLength={3} value={currency} onChange={(e) => setCurrency(e.target.value.toUpperCase())} /></div>
        <div className="field"><label>Expected date</label>
          <input type="date" value={expectedAt} onChange={(e) => setExpectedAt(e.target.value)} /></div>
      </div>

      <label>Lines</label>
      {lines.map((l, i) => (
        <div className="form-row" key={i}>
          <div className="field" style={{ flex: 2 }}>
            <select value={l.item_id} onChange={(e) => {
              const it = items.find((x) => x.id === e.target.value);
              setLine(i, { item_id: e.target.value, unit_price: l.unit_price || (it?.unit_price?.toString() ?? '') });
            }}>
              <option value="">Select item…</option>
              {items.map((it) => <option key={it.id} value={it.id}>{it.item_no} — {it.description}</option>)}
            </select>
          </div>
          <div className="field"><input type="number" min="0" step="any" placeholder="Qty"
            value={l.qty_ordered} onChange={(e) => setLine(i, { qty_ordered: e.target.value })} /></div>
          <div className="field"><input type="number" min="0" step="any" placeholder="Unit price"
            value={l.unit_price} onChange={(e) => setLine(i, { unit_price: e.target.value })} /></div>
          <button className="btn ghost sm" disabled={lines.length === 1}
            onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}>✕</button>
        </div>
      ))}
      <button className="btn secondary sm" onClick={() => setLines((ls) => [...ls, { item_id: '', qty_ordered: '1', unit_price: '' }])}>
        + Add line
      </button>

      {error && <div className="error-text">{error}</div>}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        <button className="btn" disabled={!supplierId || !poNumber} onClick={save}>Create PO</button>
      </div>
    </Modal>
  );
}

function PoDetailModal({ po, onClose }: { po: Po; onClose: () => void }) {
  return (
    <Modal title={`PO ${po.po_number}`} onClose={onClose} wide>
      <p>
        <strong>{po.supplier_name}</strong> · <StatusPill status={po.status} />
        {po.expected_at && <> · expected {fmtDate(po.expected_at)}</>}
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Item</th><th>Description</th><th className="num">Ordered</th><th className="num">Received</th><th className="num">Unit price</th></tr>
          </thead>
          <tbody>
            {po.lines?.map((l) => (
              <tr key={l.id}>
                <td><strong>{l.item_no}</strong></td>
                <td>{l.description}</td>
                <td className="num">{l.qty_ordered}</td>
                <td className="num">{l.qty_received}</td>
                <td className="num">{fmtMoney(l.unit_price, po.currency)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function ReceiveModal({ po, locations, onClose, onReceived }: {
  po: Po; locations: Lookup[]; onClose: () => void; onReceived: () => void;
}) {
  const outstanding = (po.lines ?? []).map((l) => ({ ...l, remaining: l.qty_ordered - l.qty_received }))
    .filter((l) => l.remaining > 0);
  const [qty, setQty] = useState<Record<string, string>>(
    Object.fromEntries(outstanding.map((l) => [l.id, String(l.remaining)]))
  );
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState('');

  async function submit() {
    const recvLines = outstanding
      .map((l) => ({ line_id: l.id, qty: Number(qty[l.id] ?? 0) }))
      .filter((l) => l.qty > 0)
      .map((l) => (locationId ? { ...l, to_location_id: locationId } : l));
    if (!recvLines.length) { setError('Enter a quantity to receive'); return; }
    try {
      await api(`/purchase-orders/${po.id}/receive`, { method: 'POST', body: { lines: recvLines } });
      onReceived();
    } catch (err) {
      setError(err instanceof ApiRequestError ? err.message : 'Receive failed');
    }
  }

  return (
    <Modal title={`Receive · PO ${po.po_number}`} onClose={onClose} wide>
      {outstanding.length === 0 ? (
        <p className="empty">Nothing outstanding to receive.</p>
      ) : (
        <>
          <div className="field"><label>Receive to location (blank = item default)</label>
            <select value={locationId} onChange={(e) => setLocationId(e.target.value)}>
              <option value="">Use each item's default location</option>
              {locations.map((l) => <option key={l.id} value={l.id}>{l.code ?? l.name}</option>)}
            </select>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr><th>Item</th><th className="num">Outstanding</th><th className="num">Receive now</th></tr>
              </thead>
              <tbody>
                {outstanding.map((l) => (
                  <tr key={l.id}>
                    <td><strong>{l.item_no}</strong> {l.description}</td>
                    <td className="num">{l.remaining}</td>
                    <td className="num">
                      <input type="number" min="0" max={l.remaining} step="any" style={{ width: 90 }}
                        value={qty[l.id] ?? ''} onChange={(e) => setQty({ ...qty, [l.id]: e.target.value })} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {error && <div className="error-text">{error}</div>}
      <div className="modal-actions">
        <button className="btn secondary" onClick={onClose}>Cancel</button>
        {outstanding.length > 0 && <button className="btn" onClick={submit}>Confirm receipt</button>}
      </div>
    </Modal>
  );
}
