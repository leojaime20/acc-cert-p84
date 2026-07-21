import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../features/auth/useAuth';
import { listInspections } from '../services/inspectionService';
import type { Inspection } from '../types/inspection';

const statusLabels = {
  draft: 'Draft',
  completed: 'Completed',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
};

function formatDate(inspection: Inspection) {
  const date = inspection.createdAt?.toDate?.();
  return date
    ? new Intl.DateTimeFormat('en', { dateStyle: 'short', timeStyle: 'short' }).format(date)
    : 'Now';
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
      .catch(() => setError('Unable to load inspections.'))
      .finally(() => setLoading(false));
  }, [profile]);

  return (
    <section>
      <p className="eyebrow">Records</p>
      <div className="page-heading">
        <h1>Inspections</h1>
        <span className="count-pill">{inspections.length}</span>
      </div>
      {loading && <p>Loading inspections…</p>}
      {error && <div className="notice notice-error">{error}</div>}
      {!loading && !error && inspections.length === 0 && (
        <div className="empty-state">No inspections have been created yet.</div>
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
                <span>Responsible inspector</span>
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
