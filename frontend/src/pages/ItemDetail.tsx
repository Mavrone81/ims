import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useAuth, canWrite, isManager } from '../auth';
import type { Item, Paginated, Txn } from '../types';
import { Modal, Pager, StockBadge, TxnBadge, fmtDate, fmtMoney, useToast } from '../components/ui';
import MovementModal from '../components/MovementModal';
import ItemFormModal from '../components/ItemFormModal';

export default function ItemDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { role } = useAuth();
  const toast = useToast();
  const [item, setItem] = useState<Item | null>(null);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [txnPag, setTxnPag] = useState<any>(null);
  const [txnPage, setTxnPage] = useState(1);
  const [tab, setTab] = useState<'overview' | 'history'>('overview');
  const [showMove, setShowMove] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [reversing, setReversing] = useState<Txn | null>(null);
  const [reverseReason, setReverseReason] = useState('');

  const load = useCallback(() => {
    api<Item>(`/items/${id}`).then(setItem).catch(() => navigate('/inventory'));
    api<Paginated<Txn>>(`/items/${id}/transactions?page=${txnPage}&page_size=25`).then((r) => {
      setTxns(r.data);
      setTxnPag(r.pagination);
    });
  }, [id, txnPage, navigate]);

  useEffect(load, [load]);

  async function confirmReverse() {
    if (!reversing) return;
    try {
      await api(`/transactions/${reversing.id}/reverse`, { method: 'POST', body: { reason: reverseReason } });
      toast('Reversal recorded — ledger corrected');
      setReversing(null);
      setReverseReason('');
      load();
    } catch (err: any) {
      toast(err.message ?? 'Reverse failed', true);
    }
  }

  async function archive() {
    if (!confirm(`Archive ${item?.item_no}? It will be hidden from inventory but its ledger is retained.`)) return;
    await api(`/items/${id}`, { method: 'DELETE' });
    toast('Item archived');
    navigate('/inventory');
  }

  if (!item) return <div className="empty">Loading…</div>;

  return (
    <>
      <div className="page-head">
        <h2>
          <Link to="/inventory">Inventory</Link> / {item.item_no}
        </h2>
        {canWrite(role) && <button className="btn" onClick={() => setShowMove(true)}>Record movement</button>}
        {canWrite(role) && <button className="btn secondary" onClick={() => setShowEdit(true)}>Edit</button>}
        {isManager(role) && <button className="btn danger" onClick={archive}>Archive</button>}
      </div>

      <div className="tabs">
        <button className={tab === 'overview' ? 'active' : ''} onClick={() => setTab('overview')}>Overview</button>
        <button className={tab === 'history' ? 'active' : ''} onClick={() => setTab('history')}>
          History ({txnPag?.total ?? '…'})
        </button>
      </div>

      {tab === 'overview' && (
        <div className="card">
          <h3 style={{ marginBottom: 16 }}>{item.description}</h3>
          <dl className="detail-grid">
            <div><dt>Specification</dt><dd>{item.specification ?? '—'}</dd></div>
            <div><dt>Model</dt><dd>{item.model ?? '—'}</dd></div>
            <div><dt>Supplier</dt><dd>{item.supplier?.name ?? '—'}</dd></div>
            <div><dt>Category</dt><dd>{item.category?.name ?? '—'}</dd></div>
            <div><dt>Department</dt><dd>{item.department ?? '—'}</dd></div>
            <div><dt>Default location</dt><dd>{item.default_location?.code ?? '—'}</dd></div>
            <div>
              <dt>On hand</dt>
              <dd><StockBadge qty={item.stock_on_hand} reorder={item.reorder_level} /></dd>
            </div>
            <div><dt>Reorder / max</dt><dd>{item.reorder_level} / {item.max_level ?? '—'}</dd></div>
            <div><dt>Unit price</dt><dd>{fmtMoney(item.unit_price, item.currency)}</dd></div>
            <div><dt>Value</dt><dd>{fmtMoney(item.value_native, item.currency)}</dd></div>
            <div><dt>ABC class</dt><dd>{item.abc_class ?? '—'}</dd></div>
            <div><dt>Barcode</dt><dd>{item.barcode ?? '—'}</dd></div>
          </dl>

          {item.custom_field_defs && item.custom_field_defs.length > 0 && (
            <>
              <h3 style={{ margin: '20px 0 12px', fontSize: 15 }}>Custom fields</h3>
              <dl className="detail-grid">
                {item.custom_field_defs.map((d) => (
                  <div key={d.id}>
                    <dt>{d.label}</dt>
                    <dd>{item.custom?.[d.key] !== undefined && item.custom?.[d.key] !== '' ? String(item.custom[d.key]) : '—'}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}

          {item.stock_by_location && item.stock_by_location.length > 0 && (
            <>
              <h3 style={{ margin: '20px 0 12px', fontSize: 15 }}>Stock by location</h3>
              <table style={{ maxWidth: 420 }}>
                <thead><tr><th>Location</th><th className="num">Quantity</th></tr></thead>
                <tbody>
                  {item.stock_by_location.map((s) => (
                    <tr key={s.location_id}><td>{s.location_code}</td><td className="num">{s.quantity}</td></tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {item.comments && (
            <>
              <h3 style={{ margin: '20px 0 8px', fontSize: 15 }}>Comments</h3>
              <p style={{ color: 'var(--text-muted)' }}>{item.comments}</p>
            </>
          )}
        </div>
      )}

      {tab === 'history' && (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Date</th><th>Type</th><th className="num">Qty</th><th>From</th><th>To</th>
                  <th>Purpose</th><th>Ref</th><th>By</th>{isManager(role) && <th />}
                </tr>
              </thead>
              <tbody>
                {txns.map((t) => (
                  <tr key={t.id}>
                    <td>{fmtDate(t.performed_at)}</td>
                    <td><TxnBadge type={t.type} label={t.label} />{t.reverses_txn_id && ' ↩'}</td>
                    <td className="num">{t.quantity_delta > 0 ? `+${t.quantity_delta}` : t.quantity_delta}</td>
                    <td>{t.from_location_code ?? '—'}</td>
                    <td>{t.to_location_code ?? '—'}</td>
                    <td>{t.purpose ?? '—'}</td>
                    <td>{t.reference ?? '—'}</td>
                    <td>{t.performed_by_name ?? '—'}</td>
                    {isManager(role) && (
                      <td>
                        {!t.reverses_txn_id && (
                          <button className="btn ghost sm" onClick={() => setReversing(t)}>Reverse</button>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {txnPag && <Pager p={txnPag} onPage={setTxnPage} />}
        </>
      )}

      {showMove && <MovementModal item={item} onClose={() => setShowMove(false)} onSaved={load} />}
      {showEdit && <ItemFormModal item={item} onClose={() => setShowEdit(false)} onSaved={load} />}
      {reversing && (
        <Modal title="Reverse transaction" onClose={() => setReversing(null)}>
          <p style={{ marginBottom: 14, color: 'var(--text-muted)' }}>
            The ledger is immutable — this creates a correcting entry that negates the
            {' '}{reversing.type} of {Math.abs(reversing.quantity_delta)} on {fmtDate(reversing.performed_at)}.
          </p>
          <div className="field">
            <label>Reason *</label>
            <input value={reverseReason} onChange={(e) => setReverseReason(e.target.value)} placeholder="e.g. wrong item issued" autoFocus />
          </div>
          <div className="modal-actions">
            <button className="btn secondary" onClick={() => setReversing(null)}>Cancel</button>
            <button className="btn danger" disabled={!reverseReason.trim()} onClick={confirmReverse}>Reverse entry</button>
          </div>
        </Modal>
      )}
    </>
  );
}
