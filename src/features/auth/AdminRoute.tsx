import { Navigate, Outlet } from 'react-router-dom';
import { useAuth } from './useAuth';

export function AdminRoute() {
  const { profile } = useAuth();
  return profile?.role === 'admin' ? <Outlet /> : <Navigate to="/projects" replace />;
}
