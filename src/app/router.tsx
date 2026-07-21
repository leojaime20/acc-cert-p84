import { Navigate, Route, Routes } from 'react-router-dom';
import { AppLayout } from '../components/layout/AppLayout';
import { AdminRoute } from '../features/auth/AdminRoute';
import { ProtectedRoute } from '../features/auth/ProtectedRoute';
import { AdminPage } from '../pages/AdminPage';
import { AdminDocumentsPage } from '../pages/AdminDocumentsPage';
import { AreaPage } from '../pages/AreaPage';
import { HistoryPage } from '../pages/HistoryPage';
import { InspectionPage } from '../pages/InspectionPage';
import { InspectionDocumentsPage } from '../pages/InspectionDocumentsPage';
import { LoginPage } from '../pages/LoginPage';
import { ProjectsPage } from '../pages/ProjectsPage';
import { TechnicalDocumentReaderPage } from '../pages/TechnicalDocumentReaderPage';

export function AppRouter() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route element={<ProtectedRoute />}>
        <Route element={<AppLayout />}>
          <Route path="/projects" element={<ProjectsPage />} />
          <Route path="/projects/:projectId/areas/:areaId" element={<AreaPage />} />
          <Route path="/inspections/:inspectionId" element={<InspectionPage />} />
          <Route
            path="/inspections/:inspectionId/documents"
            element={<InspectionDocumentsPage />}
          />
          <Route
            path="/inspections/:inspectionId/documents/:documentId"
            element={<TechnicalDocumentReaderPage />}
          />
          <Route path="/history" element={<HistoryPage />} />
          <Route element={<AdminRoute />}>
            <Route path="/admin" element={<AdminPage />} />
            <Route path="/admin/documents" element={<AdminDocumentsPage />} />
          </Route>
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/projects" replace />} />
    </Routes>
  );
}
