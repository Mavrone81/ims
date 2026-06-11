const API_URL = import.meta.env.VITE_API_URL ?? '/api/v1';

let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(fn: () => void) {
  onUnauthorized = fn;
}

export function getProjectId(): string | null {
  return localStorage.getItem('ims.project_id');
}
export function setProjectId(id: string) {
  localStorage.setItem('ims.project_id', id);
}

function tokens() {
  return {
    access: localStorage.getItem('ims.access_token'),
    refresh: localStorage.getItem('ims.refresh_token'),
  };
}
export function setTokens(access: string, refresh: string) {
  localStorage.setItem('ims.access_token', access);
  localStorage.setItem('ims.refresh_token', refresh);
}
export function clearTokens() {
  localStorage.removeItem('ims.access_token');
  localStorage.removeItem('ims.refresh_token');
}

export class ApiRequestError extends Error {
  constructor(public status: number, public code: string, message: string, public details?: any[]) {
    super(message);
  }
}

let refreshing: Promise<boolean> | null = null;

async function tryRefresh(): Promise<boolean> {
  refreshing ??= (async () => {
    const { refresh } = tokens();
    if (!refresh) return false;
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: refresh }),
    });
    if (!res.ok) return false;
    const data = await res.json();
    setTokens(data.access_token, data.refresh_token);
    return true;
  })().finally(() => {
    refreshing = null;
  });
  return refreshing;
}

export async function api<T = any>(
  path: string,
  options: { method?: string; body?: any; raw?: boolean } = {},
  retried = false
): Promise<T> {
  const headers: Record<string, string> = {};
  const { access } = tokens();
  if (access) headers.Authorization = `Bearer ${access}`;
  const projectId = getProjectId();
  if (projectId) headers['X-Project-Id'] = projectId;
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${API_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });

  if (res.status === 401 && !path.startsWith('/auth/') && !retried) {
    if (await tryRefresh()) return api(path, options, true);
    clearTokens();
    onUnauthorized?.();
    throw new ApiRequestError(401, 'UNAUTHORIZED', 'Session expired');
  }

  if (res.status === 204) return undefined as T;
  if (options.raw) return res as unknown as T;

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = data?.error ?? {};
    throw new ApiRequestError(res.status, err.code ?? 'ERROR', err.message ?? res.statusText, err.details);
  }
  return data;
}

export async function downloadFile(path: string, filename: string) {
  const res = await api<Response>(path, { raw: true });
  if (!res.ok) throw new Error('Download failed');
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
