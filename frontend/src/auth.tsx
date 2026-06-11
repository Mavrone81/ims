import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, setTokens, clearTokens, setUnauthorizedHandler, getProjectId, setProjectId } from './api';
import type { User } from './types';

interface AuthState {
  user: User | null;
  loading: boolean;
  activeProjectId: string | null;
  role: 'admin' | 'manager' | 'technician' | 'viewer' | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  switchProject: (id: string) => void;
}

const AuthContext = createContext<AuthState>(null as any);
export const useAuth = () => useContext(AuthContext);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(getProjectId());

  useEffect(() => {
    setUnauthorizedHandler(() => setUser(null));
    api<User>('/auth/me')
      .then((me) => {
        setUser(me);
        ensureProject(me);
      })
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function ensureProject(me: User) {
    const current = getProjectId();
    const valid = me.projects.some((p) => p.project_id === current);
    if (!valid) {
      // Org admins may have no explicit memberships; pick from /projects
      if (me.projects[0]) {
        setProjectId(me.projects[0].project_id);
        setActiveProjectId(me.projects[0].project_id);
      } else if (me.is_org_admin && !current) {
        api<{ data: { id: string }[] }>('/projects').then((r) => {
          if (r.data[0]) {
            setProjectId(r.data[0].id);
            setActiveProjectId(r.data[0].id);
          }
        });
      }
    }
  }

  async function login(email: string, password: string) {
    const res = await api<{ access_token: string; refresh_token: string; user: User }>('/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    setTokens(res.access_token, res.refresh_token);
    setUser(res.user);
    ensureProject(res.user);
  }

  function logout() {
    const refresh = localStorage.getItem('ims.refresh_token');
    if (refresh) api('/auth/logout', { method: 'POST', body: { refresh_token: refresh } }).catch(() => {});
    clearTokens();
    setUser(null);
  }

  function switchProject(id: string) {
    setProjectId(id);
    setActiveProjectId(id);
  }

  const role = user?.is_org_admin
    ? 'admin'
    : (user?.projects.find((p) => p.project_id === activeProjectId)?.role ?? null);

  return (
    <AuthContext.Provider value={{ user, loading, activeProjectId, role, login, logout, switchProject }}>
      {children}
    </AuthContext.Provider>
  );
}

export function canWrite(role: AuthState['role']) {
  return role === 'admin' || role === 'manager' || role === 'technician';
}
export function isManager(role: AuthState['role']) {
  return role === 'admin' || role === 'manager';
}
