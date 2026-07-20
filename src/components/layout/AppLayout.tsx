import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../features/auth/useAuth';

export function AppLayout() {
  const { profile, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">ACC</span>
          <span className="brand-name">Cert</span>
          <span className="brand-context">P84</span>
        </div>
        <button className="button button-quiet" onClick={() => void logout()}>
          Sair
        </button>
      </header>
      <main className="page-container">
        <div className="user-strip">
          <span>{profile?.name}</span>
          <span className="badge">{profile?.role}</span>
        </div>
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Navegação principal">
        <NavLink to="/projects">Obras</NavLink>
        <NavLink to="/history">Histórico</NavLink>
      </nav>
    </div>
  );
}
