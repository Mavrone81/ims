import { createContext, useCallback, useContext, useState, type ReactNode } from 'react';
import type { Pagination } from '../types';

/* Stock status: green = healthy, amber = at/below reorder, red = zero (docs/05_UIUX §2.1) */
export function StockBadge({ qty, reorder }: { qty: number; reorder: number }) {
  const cls = qty <= 0 ? 'red' : qty <= reorder ? 'amber' : 'green';
  return <span className={`badge ${cls}`}>{qty}</span>;
}

const TXN_COLORS: Record<string, string> = {
  receipt: 'green', opening: 'blue', issue: 'amber', transfer: 'blue',
  adjustment: 'gray', write_off: 'red',
};
export function TxnBadge({ type, label }: { type: string; label?: string | null }) {
  return <span className={`badge ${TXN_COLORS[type] ?? 'gray'}`}>{label || type.replace('_', '-')}</span>;
}

export function fmtMoney(n: number | null | undefined, currency?: string | null) {
  if (n === null || n === undefined) return '—';
  return `${currency ? currency.trim() + ' ' : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

export function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' });
}

export function Pager({ p, onPage }: { p: Pagination; onPage: (page: number) => void }) {
  if (p.total_pages <= 1) return null;
  return (
    <div className="pagination">
      <span>
        {p.total} rows · page {p.page}/{p.total_pages}
      </span>
      <button className="btn secondary sm" disabled={p.page <= 1} onClick={() => onPage(p.page - 1)}>
        ◀ Prev
      </button>
      <button className="btn secondary sm" disabled={p.page >= p.total_pages} onClick={() => onPage(p.page + 1)}>
        Next ▶
      </button>
    </div>
  );
}

/* ── Toast ──────────────────────────────────────────── */
interface ToastState { message: string; error?: boolean }
const ToastContext = createContext<(msg: string, error?: boolean) => void>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastState | null>(null);
  const show = useCallback((message: string, error = false) => {
    setToast({ message, error });
    setTimeout(() => setToast(null), 3500);
  }, []);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && <div className={`toast${toast.error ? ' error' : ''}`}>{toast.message}</div>}
    </ToastContext.Provider>
  );
}

export function Modal({ title, onClose, children, wide }: {
  title: string; onClose: () => void; children: ReactNode; wide?: boolean;
}) {
  return (
    <div className="modal-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  );
}
