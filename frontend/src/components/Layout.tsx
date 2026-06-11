import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth, isManager } from '../auth';
import { api } from '../api';

interface ProjectOption {
  id: string;
  name: string;
  code: string;
}

export default function Layout() {
  const { user, role, activeProjectId, switchProject, logout } = useAuth();
  const [projects, setProjects] = useState<ProjectOption[]>([]);

  useEffect(() => {
    api<{ data: any[] }>('/projects')
      .then((r) => setProjects(r.data.map((p) => ({ id: p.id, name: p.name, code: p.code }))))
      .catch(() => {});
  }, [user]);

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="brand">IMS</div>
        <nav>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/inventory">Inventory</NavLink>
          <NavLink to="/movements">Movements</NavLink>
          <NavLink to="/reports">Reports</NavLink>
          <NavLink to="/suppliers">Suppliers</NavLink>
          {isManager(role) && (
            <>
              <div className="section-label">Admin</div>
              <NavLink to="/admin">Administration</NavLink>
            </>
          )}
        </nav>
      </aside>
      <div className="main">
        <header className="topbar">
          <select
            value={activeProjectId ?? ''}
            onChange={(e) => {
              switchProject(e.target.value);
              window.location.reload();
            }}
            aria-label="Active project"
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                Project: {p.name}
              </option>
            ))}
          </select>
          <div className="spacer" />
          <span className="user-chip">
            {user?.full_name} · {role ?? 'no role'}
          </span>
          <button className="btn secondary sm" onClick={logout}>
            Sign out
          </button>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
