import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/useAuth';
import { listInspections } from '../services/inspectionService';
import type { Inspection } from '../types/inspection';

const statusLabels = {
  draft: 'Rascunho',
  completed: 'Concluída',
  reopened: 'Reaberta',
  cancelled: 'Cancelada',
};

function formatDate(inspection: Inspection) {
  const date = inspection.createdAt?.toDate?.();
  return date
    ? new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : 'Agora';
}

export function HistoryPage() {
  const { profile } = useAuth();
  const [inspections, setInspections] = useState<Inspection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!profile) return;
    void listInspections(profile.projectIds, profile.role === 'admin')
      .then(setInspections)
      .catch(() => setError('Não foi possível carregar as inspeções.'))
      .finally(() => setLoading(false));
  }, [profile]);

  return (
    <section>
      <p className="eyebrow">Registros</p>
      <div className="page-heading">
        <h1>Inspeções</h1>
        <span className="count-pill">{inspections.length}</span>
      </div>
      {loading && <p>Carregando inspeções…</p>}
      {error && <div className="notice notice-error">{error}</div>}
      {!loading && !error && inspections.length === 0 && (
        <div className="empty-state">Nenhuma inspeção criada até o momento.</div>
      )}
      <div className="inspection-list">
        {inspections.map((inspection) => (
          <Link
            className="inspection-card"
            key={inspection.id}
            to={`/inspections/${inspection.id}`}
          >
            <div className="inspection-card-topline">
              <strong>{inspection.areaCode || inspection.areaId}</strong>
              <span className={`status-chip status-${inspection.status}`}>
                {statusLabels[inspection.status]}
              </span>
            </div>
            <h2>{inspection.areaName || inspection.code}</h2>
            <div className="inspector-line">
              <span className="avatar" aria-hidden="true">
                {inspection.inspectorName?.charAt(0).toUpperCase() || 'I'}
              </span>
              <div>
                <span>Inspetor responsável</span>
                <strong>{inspection.inspectorName}</strong>
                <small>{inspection.inspectorEmail}</small>
              </div>
            </div>
            <div className="inspection-card-footer">
              <span>{inspection.checklistTemplateCode || inspection.checklistTemplateId}</span>
              <time>{formatDate(inspection)}</time>
            </div>
          </Link>
        ))}
      </div>
    </section>
  );
}
