import { NavLink, Outlet } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth, isManager } from '../auth';
import { api } from '../api';
import ChangePasswordModal from './ChangePasswordModal';

interface ProjectOption {
  id: string;
  name: string;
  code: string;
}

export default function Layout() {
  const { user, role, activeProjectId, switchProject, logout } = useAuth();
  const [projects, setProjects] = useState<ProjectOption[]>([]);
  const [navOpen, setNavOpen] = useState(false);
  const [showChangePw, setShowChangePw] = useState(false);

  useEffect(() => {
    api<{ data: any[] }>('/projects')
      .then((r) => setProjects(r.data.map((p) => ({ id: p.id, name: p.name, code: p.code }))))
      .catch(() => {});
  }, [user]);

  const closeNav = () => setNavOpen(false);

  return (
    <div className="app">
      {navOpen && <div className="nav-backdrop" onClick={closeNav} aria-hidden="true" />}
      <aside className={`sidebar${navOpen ? ' open' : ''}`}>
        <div className="brand">
          <img src="/logo.svg" alt="" className="brand-logo" />
          <span>IMS</span>
        </div>
        <nav onClick={closeNav}>
          <NavLink to="/" end>Dashboard</NavLink>
          <NavLink to="/inventory">Inventory</NavLink>
          <NavLink to="/movements">Movements</NavLink>
          <NavLink to="/reports">Reports</NavLink>
          <NavLink to="/suppliers">Suppliers</NavLink>
          <NavLink to="/purchasing">Purchasing</NavLink>
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
          <button
            className="hamburger"
            aria-label={navOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={navOpen}
            onClick={() => setNavOpen((o) => !o)}
          >
            ☰
          </button>
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
          <button className="btn secondary sm" onClick={() => setShowChangePw(true)}>
            Change password
          </button>
          <button className="btn secondary sm" onClick={logout}>
            Sign out
          </button>
        </header>
        {showChangePw && <ChangePasswordModal onClose={() => setShowChangePw(false)} />}
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
