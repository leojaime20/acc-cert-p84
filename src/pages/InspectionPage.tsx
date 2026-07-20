import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { getInspection, listInspectionItems } from '../services/inspectionService';
import type { Inspection, InspectionItem } from '../types/inspection';

export function InspectionPage() {
  const { inspectionId } = useParams();
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!inspectionId) return;
    void Promise.all([getInspection(inspectionId), listInspectionItems(inspectionId)])
      .then(([nextInspection, nextItems]) => {
        setInspection(nextInspection);
        setItems(nextItems);
      })
      .catch(() => setError('Não foi possível carregar esta inspeção.'))
      .finally(() => setLoading(false));
  }, [inspectionId]);

  return (
    <section>
      <p className="eyebrow">Inspeção</p>
      <h1>{inspection?.code || (loading ? 'Carregando…' : inspectionId)}</h1>
      {error && <div className="notice notice-error">{error}</div>}
      {inspection && (
        <>
          <div className="inspection-meta">
            <div>
              <span>Área</span>
              <strong>{inspection.areaCode}</strong>
              <small>{inspection.areaName}</small>
            </div>
            <div>
              <span>Inspetor responsável</span>
              <strong>{inspection.inspectorName}</strong>
              <small>{inspection.inspectorEmail}</small>
            </div>
            <div>
              <span>Status</span>
              <strong className="status-chip status-draft">Rascunho</strong>
              <small>{inspection.checklistTemplateCode}</small>
            </div>
          </div>

          <div className="section-heading">
            <div>
              <p className="eyebrow">Checklist copiado</p>
              <h2>{items.length} itens para verificação</h2>
            </div>
          </div>
          <div className="checklist-list">
            {items.map((item) => (
              <article className="checklist-item" key={item.id}>
                <span className="item-number">{item.itemNumber}</span>
                <div>
                  <strong>{item.code}</strong>
                  <p>{item.description}</p>
                  <span className="status-chip">Não iniciado</span>
                </div>
              </article>
            ))}
          </div>
          <div className="notice notice-warning operation-notice">
            O preenchimento e a conclusão dos itens serão habilitados na próxima etapa operacional.
          </div>
          <Link className="text-link" to="/history">
            Ver todas as inspeções
          </Link>
        </>
      )}
    </section>
  );
}
