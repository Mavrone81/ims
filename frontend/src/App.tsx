import { Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { useAuth } from './auth';
import Platform from './pages/Platform';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import Inventory from './pages/Inventory';
import ItemDetail from './pages/ItemDetail';
import Movements from './pages/Movements';
import Reports from './pages/Reports';
import Suppliers from './pages/Suppliers';
import Assistant from './pages/Assistant';
import Admin from './pages/Admin';

export default function App() {
  const { user, loading } = useAuth();
  const location = useLocation();

  // Platform console is independent of org-user sessions
  if (location.pathname.startsWith('/platform')) return <Platform />;

  if (loading) return <div className="empty">Loading…</div>;
  if (!user) return <Login />;

  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/" element={<Dashboard />} />
        <Route path="/inventory" element={<Inventory />} />
        <Route path="/inventory/:id" element={<ItemDetail />} />
        <Route path="/movements" element={<Movements />} />
        <Route path="/reports" element={<Reports />} />
        <Route path="/suppliers" element={<Suppliers />} />
        <Route path="/assistant" element={<Assistant />} />
        <Route path="/admin/*" element={<Admin />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
