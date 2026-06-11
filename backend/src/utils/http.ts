import type { Request, Response, NextFunction, RequestHandler } from 'express';

export function asyncHandler(fn: (req: Request, res: Response) => Promise<any>): RequestHandler {
  return (req, res, next: NextFunction) => fn(req, res).catch(next);
}

export interface Pagination {
  page: number;
  pageSize: number;
  offset: number;
}

export function getPagination(req: Request, defaultSize = 50, maxSize = 200): Pagination {
  const page = Math.max(1, Number(req.query.page) || 1);
  const pageSize = Math.min(maxSize, Math.max(1, Number(req.query.page_size) || defaultSize));
  return { page, pageSize, offset: (page - 1) * pageSize };
}

export function paginated(data: any[], total: number, { page, pageSize }: Pagination) {
  return {
    data,
    pagination: { page, page_size: pageSize, total, total_pages: Math.ceil(total / pageSize) },
  };
}

/** Whitelist-based ORDER BY builder. */
export function getSort(req: Request, allowed: Record<string, string>, fallback: string): string {
  const sort = String(req.query.sort ?? '');
  const order = String(req.query.order ?? 'asc').toLowerCase() === 'desc' ? 'DESC' : 'ASC';
  const column = allowed[sort];
  return column ? `${column} ${order}` : fallback;
}

/** Serialize rows to CSV with the given header->key mapping. */
export function toCsv(rows: any[], columns: { header: string; key: string }[]): string {
  const escape = (v: any) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [columns.map((c) => escape(c.header)).join(',')];
  for (const row of rows) lines.push(columns.map((c) => escape(row[c.key])).join(','));
  return lines.join('\n');
}
