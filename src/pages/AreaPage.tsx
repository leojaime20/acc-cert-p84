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
      .catch(() => setError('Não foi possível carregar os dados desta área.'))
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
      setError('Não foi possível criar a inspeção. Tente novamente.');
      setCreating(false);
    }
  }

  return (
    <section>
      <p className="eyebrow">Área/Zona</p>
      <h1>{area?.code || (loading ? 'Carregando…' : areaId)}</h1>
      {area && (
        <div className="area-summary">
          <div>
            <span>Descrição</span>
            <strong>{area.name}</strong>
          </div>
          <div>
            <span>Localização</span>
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
        <h2>Nova inspeção</h2>
        <p>
          O checklist da área será copiado para um novo rascunho em nome de{' '}
          <strong>{profile?.name}</strong>.
        </p>
        <button
          className="button button-primary"
          disabled={!area || !profile || creating}
          onClick={() => void handleCreate()}
        >
          {creating ? 'Criando inspeção…' : 'Iniciar inspeção'}
        </button>
      </div>
      <Link className="text-link" to={`/projects`}>
        ← Voltar às áreas de {projectId}
      </Link>
    </section>
  );
}
