import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useAuth } from './useAuth';

export function ProtectedRoute() {
  const { user, profile, loading } = useAuth();
  const location = useLocation();

  if (loading) return <main className="centered-page">Carregando…</main>;
  if (!user) return <Navigate to="/login" state={{ from: location }} replace />;
  if (!profile?.active) return <main className="centered-page">Usuário sem acesso ativo.</main>;
  return <Outlet />;
}
