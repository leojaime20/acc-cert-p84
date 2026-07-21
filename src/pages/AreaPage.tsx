import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useAuth } from '../features/auth/useAuth';
import { createInspection } from '../services/inspectionService';
import { getArea } from '../services/projectService';
import type { Area } from '../types/project';

export function AreaPage() {
  const { projectId, areaId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const [area, setArea] = useState<Area | null>(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!projectId || !areaId) return;
    void getArea(projectId, areaId)
      .then(setArea)
      .catch(() => setError('Unable to load this area.'))
      .finally(() => setLoading(false));
  }, [areaId, projectId]);

  async function handleCreate() {
    if (!area || !profile) return;
    setCreating(true);
    setError('');
    try {
      const inspectionId = await createInspection(area, profile);
      navigate(`/inspections/${inspectionId}`);
    } catch {
      setError('Unable to create the inspection. Try again.');
      setCreating(false);
    }
  }

  return (
    <section>
      <p className="eyebrow">Area / zone</p>
      <h1>{area?.code || (loading ? 'Loading…' : areaId)}</h1>
      {area && (
        <div className="area-summary">
          <div>
            <span>Description</span>
            <strong>{area.name}</strong>
          </div>
          <div>
            <span>Location</span>
            <strong>{area.location}</strong>
          </div>
          <div>
            <span>Checklist</span>
            <strong>{area.checklistTemplateId}</strong>
          </div>
        </div>
      )}
      {error && <div className="notice notice-error">{error}</div>}
      <div className="action-card">
        <h2>New inspection</h2>
        <p>
          The area checklist will be copied into a new draft for <strong>{profile?.name}</strong>.
        </p>
        <button
          className="button button-primary"
          disabled={!area || !profile || creating}
          onClick={() => void handleCreate()}
        >
          {creating ? 'Creating inspection…' : 'Start inspection'}
        </button>
      </div>
      <Link className="text-link" to={`/projects`}>
        ← Back to {projectId} areas
      </Link>
    </section>
  );
}
