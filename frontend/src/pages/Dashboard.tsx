import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import type { Paginated, Txn } from '../types';
import { StockBadge, TxnBadge, fmtDate, fmtMoney } from '../components/ui';

interface LowStockRow {
  item_id: string;
  item_no: string;
  description: string;
  stock_on_hand: number;
  reorder_level: number;
  supplier: string | null;
}

export default function Dashboard() {
  const [totalItems, setTotalItems] = useState<number | null>(null);
  const [totalValue, setTotalValue] = useState<{ amount: number; currency: string } | null>(null);
  const [low, setLow] = useState<LowStockRow[]>([]);
  const [recent, setRecent] = useState<Txn[]>([]);

  useEffect(() => {
    api<Paginated<any>>('/items?page_size=1').then((r) => setTotalItems(r.pagination.total));
    api<any>('/reports/valuation').then((r) =>
      setTotalValue({ amount: r.summary.total_value_base, currency: r.summary.base_currency })
    );
    api<{ data: LowStockRow[] }>('/stock/low').then((r) => setLow(r.data));
    api<Paginated<Txn>>('/transactions?page_size=10').then((r) => setRecent(r.data));
  }, []);

  const outCount = low.filter((l) => l.stock_on_hand <= 0).length;

  return (
    <>
      <div className="page-head">
        <h2>Dashboard</h2>
      </div>
      <div className="kpi-row">
        <div className="card kpi">
          <div className="kpi-value">{totalItems ?? '…'}</div>
          <div className="kpi-label">Items</div>
        </div>
        <div className="card kpi">
          <div className="kpi-value">{totalValue ? fmtMoney(totalValue.amount, totalValue.currency) : '…'}</div>
          <div className="kpi-label">Stock value (base currency)</div>
        </div>
        <div className="card kpi">
          <div className="kpi-value" style={{ color: low.length ? 'var(--warning)' : undefined }}>{low.length}</div>
          <div className="kpi-label">Low stock</div>
        </div>
        <div className="card kpi">
          <div className="kpi-value" style={{ color: outCount ? 'var(--danger)' : undefined }}>{outCount}</div>
          <div className="kpi-label">Out of stock</div>
        </div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Low stock (reorder)</h3>
          {low.length === 0 ? (
            <div className="empty">All items above reorder level 🎉</div>
          ) : (
            <table>
              <thead>
                <tr><th>Item</th><th>Description</th><th className="num">On hand / reorder</th><th>Supplier</th></tr>
              </thead>
              <tbody>
                {low.slice(0, 10).map((r) => (
                  <tr key={r.item_id}>
                    <td><Link to={`/inventory/${r.item_id}`}>{r.item_no}</Link></td>
                    <td>{r.description}</td>
                    <td className="num">
                      <StockBadge qty={r.stock_on_hand} reorder={r.reorder_level} /> / {r.reorder_level}
                    </td>
                    <td>{r.supplier ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card">
          <h3 style={{ marginBottom: 12 }}>Recent movements</h3>
          {recent.length === 0 ? (
            <div className="empty">No transactions yet</div>
          ) : (
            <table>
              <thead>
                <tr><th>Date</th><th>Type</th><th>Item</th><th className="num">Qty</th><th>Ref</th></tr>
              </thead>
              <tbody>
                {recent.map((t) => (
                  <tr key={t.id}>
                    <td>{fmtDate(t.performed_at)}</td>
                    <td><TxnBadge type={t.type} /></td>
                    <td><Link to={`/inventory/${t.item_id}`}>{t.item_no}</Link></td>
                    <td className="num">{t.quantity_delta > 0 ? `+${t.quantity_delta}` : t.quantity_delta}</td>
                    <td>{t.reference ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </>
  );
}
