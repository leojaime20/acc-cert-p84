import { NavLink, Outlet } from 'react-router-dom';
import { useAuth } from '../../features/auth/useAuth';

export function AppLayout() {
  const { profile, logout } = useAuth();

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark">AC</span>
          <span className="brand-name">Certificate</span>
          <span className="brand-context">P84</span>
        </div>
        <button className="button button-quiet" onClick={() => void logout()}>
          Sign out
        </button>
      </header>
      <main className="page-container">
        <div className="user-strip">
          <span>{profile?.name}</span>
          <span className="badge">{profile?.role}</span>
        </div>
        <Outlet />
      </main>
      <nav className="bottom-nav" aria-label="Main navigation">
        <NavLink to="/projects">Projects</NavLink>
        <NavLink to="/history">Inspections</NavLink>
        {profile?.role === 'admin' && <NavLink to="/admin">Administration</NavLink>}
      </nav>
    </div>
  );
}
