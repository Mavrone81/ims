import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Paginated, Txn } from '../types';
import { Pager, TxnBadge, fmtDate } from '../components/ui';

export default function Movements() {
  const [txns, setTxns] = useState<Txn[]>([]);
  const [pagination, setPagination] = useState<any>(null);
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [reference, setReference] = useState('');

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page), page_size: '50' });
    if (type) params.set('type', type);
    if (dateFrom) params.set('date_from', dateFrom);
    if (dateTo) params.set('date_to', dateTo);
    if (reference) params.set('reference', reference);
    api<Paginated<Txn>>(`/transactions?${params}`).then((r) => {
      setTxns(r.data);
      setPagination(r.pagination);
    });
  }, [page, type, dateFrom, dateTo, reference]);

  useEffect(() => {
    const t = setTimeout(load, reference ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, reference]);

  return (
    <>
      <div className="page-head">
        <h2>Movements</h2>
      </div>
      <div className="filters">
        <select value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}>
          <option value="">All types</option>
          {['receipt', 'issue', 'transfer', 'adjustment', 'write_off', 'opening'].map((t) => (
            <option key={t} value={t}>{t.replace('_', '-')}</option>
          ))}
        </select>
        <input type="date" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); setPage(1); }} />
        <input type="date" value={dateTo} onChange={(e) => { setDateTo(e.target.value); setPage(1); }} />
        <input type="search" placeholder="Reference (WO/PO)…" value={reference} onChange={(e) => { setReference(e.target.value); setPage(1); }} />
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Type</th><th>Item</th><th>Description</th><th className="num">Qty</th>
              <th>From</th><th>To</th><th>Purpose</th><th>Ref</th><th>By</th>
            </tr>
          </thead>
          <tbody>
            {txns.length === 0 ? (
              <tr><td colSpan={10} className="empty">No transactions match the filters.</td></tr>
            ) : (
              txns.map((t) => (
                <tr key={t.id}>
                  <td>{fmtDate(t.performed_at)}</td>
                  <td><TxnBadge type={t.type} />{t.reverses_txn_id && ' ↩'}</td>
                  <td><Link to={`/inventory/${t.item_id}`}>{t.item_no}</Link></td>
                  <td>{t.item_description}</td>
                  <td className="num">{t.quantity_delta > 0 ? `+${t.quantity_delta}` : t.quantity_delta}</td>
                  <td>{t.from_location_code ?? '—'}</td>
                  <td>{t.to_location_code ?? '—'}</td>
                  <td>{t.purpose ?? '—'}</td>
                  <td>{t.reference ?? '—'}</td>
                  <td>{t.performed_by_name ?? '—'}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination && <Pager p={pagination} onPage={setPage} />}
    </>
  );
}
