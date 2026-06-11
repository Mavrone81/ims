import { useEffect, useState } from 'react';
import { api, downloadFile } from '../api';
import { fmtMoney, useToast } from '../components/ui';

type ReportKey = 'valuation' | 'reorder' | 'movements' | 'abc' | 'write-offs';

const REPORTS: { key: ReportKey; title: string; desc: string }[] = [
  { key: 'valuation', title: 'Stock valuation', desc: 'On-hand value per item, converted to base currency' },
  { key: 'reorder', title: 'Reorder / low stock', desc: 'Items at or below their reorder level' },
  { key: 'movements', title: 'Movements summary', desc: 'Transaction counts and quantities by type' },
  { key: 'abc', title: 'ABC analysis', desc: 'Items classified by value share (80/15/5)' },
  { key: 'write-offs', title: 'Write-offs', desc: 'Write-off history with value and reason' },
];

export default function Reports() {
  const toast = useToast();
  const [active, setActive] = useState<ReportKey>('valuation');
  const [rows, setRows] = useState<any[]>([]);
  const [summary, setSummary] = useState<any>(null);
  const [base, setBase] = useState('USD');
  const [currencies, setCurrencies] = useState<{ code: string }[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api<{ data: { code: string }[] }>('/currencies').then((r) => setCurrencies(r.data));
  }, []);

  useEffect(() => {
    setLoading(true);
    setSummary(null);
    api<any>(`/reports/${active}?base_currency=${base}`)
      .then((r) => {
        setRows(r.data);
        if (r.summary) setSummary(r.summary);
      })
      .finally(() => setLoading(false));
  }, [active, base]);

  const headers: Record<ReportKey, string[]> = {
    valuation: ['Item No', 'Description', 'Category', 'On hand', 'Unit price', 'Value (native)', `Value (${base})`],
    reorder: ['Item No', 'Description', 'On hand', 'Reorder level', 'Supplier', 'Lead time'],
    movements: ['Type', 'Transactions', 'Qty in', 'Qty out'],
    abc: ['Item No', 'Description', 'On hand', `Value (${base})`, 'Class'],
    'write-offs': ['Date', 'Item No', 'Description', 'Qty', 'Purpose', 'By'],
  };

  function cells(r: any): (string | number)[] {
    switch (active) {
      case 'valuation':
        return [r.item_no, r.description, r.category ?? '—', r.stock_on_hand,
                fmtMoney(r.unit_price, r.currency), fmtMoney(r.value_native, r.currency),
                r.value_base === null ? 'no rate' : fmtMoney(r.value_base, r.base_currency)];
      case 'reorder':
        return [r.item_no, r.description, r.stock_on_hand, r.reorder_level, r.supplier ?? '—',
                r.lead_time_days ? `${r.lead_time_days}d` : '—'];
      case 'movements':
        return [r.type, r.txn_count, r.qty_in, r.qty_out];
      case 'abc':
        return [r.item_no, r.description, r.stock_on_hand, fmtMoney(r.value_base, base), r.abc_class];
      case 'write-offs':
        return [new Date(r.performed_at).toLocaleDateString(), r.item_no, r.description, r.quantity,
                r.purpose ?? '—', r.performed_by ?? '—'];
    }
  }

  return (
    <>
      <div className="page-head">
        <h2>Reports</h2>
        <select value={base} onChange={(e) => setBase(e.target.value)} style={{ width: 'auto' }}>
          {currencies.map((c) => (
            <option key={c.code} value={c.code.trim()}>Base: {c.code}</option>
          ))}
        </select>
        <button
          className="btn secondary"
          onClick={() =>
            downloadFile(`/reports/${active}?base_currency=${base}&format=csv`, `${active}.csv`).catch(() =>
              toast('Export failed', true)
            )
          }
        >
          Export CSV
        </button>
      </div>

      <div className="tabs">
        {REPORTS.map((r) => (
          <button key={r.key} className={active === r.key ? 'active' : ''} onClick={() => setActive(r.key)} title={r.desc}>
            {r.title}
          </button>
        ))}
      </div>

      {summary && (
        <div className="card kpi" style={{ marginBottom: 16, maxWidth: 320 }}>
          <div className="kpi-value">{fmtMoney(summary.total_value_base, summary.base_currency)}</div>
          <div className="kpi-label">Total stock value as of {summary.as_of}</div>
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>{headers[active].map((h) => <th key={h}>{h}</th>)}</tr>
          </thead>
          <tbody>
            {loading ? (
              <tr><td colSpan={headers[active].length} className="empty">Loading…</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={headers[active].length} className="empty">No data.</td></tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i}>{cells(r).map((c, j) => <td key={j}>{c}</td>)}</tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
