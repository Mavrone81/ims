import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, downloadFile } from '../api';
import { useAuth, canWrite } from '../auth';
import type { Item, Lookup, Paginated, Pagination } from '../types';
import { StockBadge, Pager, fmtMoney, useToast } from '../components/ui';
import ItemFormModal from '../components/ItemFormModal';
import MovementModal from '../components/MovementModal';

export default function Inventory() {
  const navigate = useNavigate();
  const { role } = useAuth();
  const toast = useToast();
  const [items, setItems] = useState<Item[]>([]);
  const [pagination, setPagination] = useState<Pagination | null>(null);
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [supplierId, setSupplierId] = useState('');
  const [status, setStatus] = useState('');
  const [categories, setCategories] = useState<Lookup[]>([]);
  const [suppliers, setSuppliers] = useState<Lookup[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [movementItem, setMovementItem] = useState<Item | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    const params = new URLSearchParams({ page: String(page), page_size: '50' });
    if (q) params.set('q', q);
    if (categoryId) params.set('category_id', categoryId);
    if (supplierId) params.set('supplier_id', supplierId);
    if (status) params.set('stock_status', status);
    api<Paginated<Item>>(`/items?${params}`)
      .then((r) => {
        setItems(r.data);
        setPagination(r.pagination);
      })
      .finally(() => setLoading(false));
  }, [page, q, categoryId, supplierId, status]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  useEffect(() => {
    api<{ data: Lookup[] }>('/categories').then((r) => setCategories(r.data));
    api<{ data: Lookup[] }>('/suppliers').then((r) => setSuppliers(r.data));
  }, []);

  return (
    <>
      <div className="page-head">
        <h2>Inventory</h2>
        <button
          className="btn secondary"
          onClick={() => downloadFile('/items/export?format=csv', 'items.csv').catch(() => toast('Export failed', true))}
        >
          Export CSV
        </button>
        {canWrite(role) && (
          <button className="btn" onClick={() => setShowForm(true)}>+ New item</button>
        )}
      </div>

      <div className="filters">
        <input
          type="search"
          placeholder="Search item no, description, model…"
          value={q}
          onChange={(e) => { setQ(e.target.value); setPage(1); }}
        />
        <select value={categoryId} onChange={(e) => { setCategoryId(e.target.value); setPage(1); }}>
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <select value={supplierId} onChange={(e) => { setSupplierId(e.target.value); setPage(1); }}>
          <option value="">All suppliers</option>
          {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">All stock status</option>
          <option value="in">In stock</option>
          <option value="low">Low</option>
          <option value="out">Out</option>
        </select>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Item No</th><th>Description</th><th>Model</th><th>Supplier</th>
              <th>Location</th><th className="num">On hand</th><th className="num">Unit price</th>
              <th className="num">Value</th><th>ABC</th>{canWrite(role) && <th />}
            </tr>
          </thead>
          <tbody>
            {loading && items.length === 0 ? (
              <tr><td colSpan={10} className="empty">Loading…</td></tr>
            ) : items.length === 0 ? (
              <tr><td colSpan={10} className="empty">No items found — adjust filters or add your first item.</td></tr>
            ) : (
              items.map((item) => (
                <tr key={item.id} className="row-link" onClick={() => navigate(`/inventory/${item.id}`)}>
                  <td><strong>{item.item_no}</strong></td>
                  <td>{item.description}</td>
                  <td>{item.model ?? '—'}</td>
                  <td>{item.supplier?.name ?? '—'}</td>
                  <td>{item.default_location?.code ?? '—'}</td>
                  <td className="num"><StockBadge qty={item.stock_on_hand} reorder={item.reorder_level} /></td>
                  <td className="num">{fmtMoney(item.unit_price, item.currency)}</td>
                  <td className="num">{fmtMoney(item.value_native, item.currency)}</td>
                  <td>{item.abc_class ?? '—'}</td>
                  {canWrite(role) && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <button className="btn ghost sm" onClick={() => setMovementItem(item)}>Move</button>
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {pagination && <Pager p={pagination} onPage={setPage} />}

      {showForm && <ItemFormModal onClose={() => setShowForm(false)} onSaved={load} />}
      {movementItem && (
        <MovementModal item={movementItem} onClose={() => setMovementItem(null)} onSaved={load} />
      )}
    </>
  );
}
