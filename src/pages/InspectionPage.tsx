import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChecklistItemEditor } from '../components/inspection/ChecklistItemEditor';
import { PhotoUploader } from '../components/inspection/PhotoUploader';
import { useAuth } from '../features/auth/useAuth';
import {
  finalizeInspection,
  getInspection,
  listInspectionItems,
} from '../services/inspectionService';
import { getStorageDownloadUrl, listInspectionPhotos } from '../services/photoService';
import { listTechnicalDocumentsForArea } from '../services/technicalDocumentService';
import type {
  Inspection,
  InspectionItem,
  InspectionPhoto,
  InspectionSummary,
} from '../types/inspection';

const statusLabels = {
  draft: 'Rascunho',
  completed: 'Concluída',
  reopened: 'Reaberta',
  cancelled: 'Cancelada',
};

const reportLabels = {
  pending: 'Relatório na fila',
  processing: 'Gerando relatório…',
  completed: 'Relatório pronto',
  error: 'Erro ao gerar relatório',
};

export function InspectionPage() {
  const { inspectionId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const pendingItemFlushes = useRef(new Map<string, () => Promise<void>>());
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [items, setItems] = useState<InspectionItem[]>([]);
  const [photos, setPhotos] = useState<InspectionPhoto[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [photoError, setPhotoError] = useState('');
  const [reportError, setReportError] = useState('');
  const [finalizing, setFinalizing] = useState(false);
  const [pending, setPending] = useState<string[]>([]);
  const [reportUrl, setReportUrl] = useState('');
  const [documentCount, setDocumentCount] = useState(0);
  const [openingDocuments, setOpeningDocuments] = useState(false);

  const refreshInspection = useCallback(async () => {
    if (!inspectionId) return;
    const nextInspection = await getInspection(inspectionId);
    setInspection(nextInspection);
    if (nextInspection.reportStoragePath) {
      try {
        setReportUrl(await getStorageDownloadUrl(nextInspection.reportStoragePath));
        setReportError('');
      } catch {
        setReportError('O relatório foi gerado, mas não pôde ser aberto agora.');
      }
    }
  }, [inspectionId]);

  useEffect(() => {
    if (!inspectionId) return;
    let active = true;

    void getInspection(inspectionId)
      .then((nextInspection) => {
        if (!active) return;
        setInspection(nextInspection);
        void listTechnicalDocumentsForArea(nextInspection.projectId, nextInspection.areaId)
          .then((documents) => {
            if (active) setDocumentCount(documents.length);
          })
          .catch(() => {
            if (active) setDocumentCount(0);
          });
        if (nextInspection.reportStoragePath) {
          void getStorageDownloadUrl(nextInspection.reportStoragePath)
            .then((url) => {
              if (active) setReportUrl(url);
            })
            .catch(() => {
              if (active) setReportError('O relatório foi gerado, mas não pôde ser aberto agora.');
            });
        }
      })
      .catch(() => {
        if (active) setError('Não foi possível carregar esta inspeção.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    void listInspectionItems(inspectionId)
      .then((nextItems) => {
        if (active) setItems(nextItems);
      })
      .catch(() => {
        if (active) setError('A inspeção foi carregada, mas os itens não estão disponíveis agora.');
      });

    void listInspectionPhotos(inspectionId)
      .then((nextPhotos) => {
        if (!active) return;
        setPhotos(nextPhotos);
        setPhotoError('');
      })
      .catch(() => {
        if (active)
          setPhotoError(
            'As fotografias não puderam ser carregadas. Os demais dados continuam disponíveis.',
          );
      });

    return () => {
      active = false;
    };
  }, [inspectionId]);

  useEffect(() => {
    if (!inspection?.reportStatus || !['pending', 'processing'].includes(inspection.reportStatus)) {
      return;
    }
    const timer = window.setInterval(() => void refreshInspection(), 3000);
    return () => window.clearInterval(timer);
  }, [inspection?.reportStatus, refreshInspection]);

  const editable = Boolean(
    profile &&
    inspection &&
    ['draft', 'reopened'].includes(inspection.status) &&
    profile.uid === inspection.inspectorId,
  );
  const generalPhotos = photos.filter((photo) => photo.itemId === null);

  function updateLocalItem(item: InspectionItem, summary: InspectionSummary) {
    setItems((current) =>
      current.map((currentItem) => (currentItem.id === item.id ? item : currentItem)),
    );
    setInspection((current) => (current ? { ...current, summary } : current));
  }

  function addPhoto(photo: InspectionPhoto) {
    setPhotos((current) => [...current, photo]);
  }

  function removePhoto(photoId: string) {
    setPhotos((current) => current.filter((photo) => photo.id !== photoId));
  }

  const registerPendingFlush = useCallback(
    (itemId: string, flush: (() => Promise<void>) | null) => {
      if (flush) pendingItemFlushes.current.set(itemId, flush);
      else pendingItemFlushes.current.delete(itemId);
    },
    [],
  );

  async function openDocuments() {
    if (!inspectionId) return;
    setOpeningDocuments(true);
    setError('');
    try {
      await Promise.all([...pendingItemFlushes.current.values()].map((flush) => flush()));
      navigate(`/inspections/${inspectionId}/documents`);
    } catch {
      setError('Não foi possível salvar as últimas alterações antes de abrir os documentos.');
      setOpeningDocuments(false);
    }
  }

  async function handleFinalize() {
    if (!inspectionId) return;
    setFinalizing(true);
    setPending([]);
    setError('');
    try {
      await finalizeInspection(inspectionId);
      await refreshInspection();
    } catch (finalizeError) {
      const details = (finalizeError as { details?: { pending?: string[] } }).details;
      setPending(details?.pending || ['Não foi possível finalizar. Revise os itens da inspeção.']);
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <section className="inspection-page">
      <p className="eyebrow">Inspeção</p>
      <div className="inspection-title-row">
        <h1>{inspection?.code || (loading ? 'Carregando…' : inspectionId)}</h1>
        {inspection && (
          <button
            className="button inspection-documents-button"
            disabled={openingDocuments}
            onClick={() => void openDocuments()}
          >
            <span aria-hidden="true">PDF</span>
            <strong>{openingDocuments ? 'Salvando…' : 'Documentos'}</strong>
            {documentCount > 0 && <small>{documentCount}</small>}
          </button>
        )}
      </div>
      {error && <div className="notice notice-error">{error}</div>}
      {inspection && profile && (
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
              <strong className={`status-chip status-${inspection.status}`}>
                {statusLabels[inspection.status]}
              </strong>
              <small>{inspection.checklistTemplateCode}</small>
            </div>
          </div>

          <div className="summary-grid" aria-label="Resumo da inspeção">
            <div>
              <strong>{inspection.summary.notStarted}</strong>
              <span>Pendentes</span>
            </div>
            <div>
              <strong>{inspection.summary.approved}</strong>
              <span>Aprovados</span>
            </div>
            <div>
              <strong>{inspection.summary.partiallyApproved}</strong>
              <span>Parciais</span>
            </div>
            <div>
              <strong>{inspection.summary.rejected}</strong>
              <span>Reprovados</span>
            </div>
            <div>
              <strong>{inspection.summary.notApplicable}</strong>
              <span>Não aplicáveis</span>
            </div>
          </div>

          <section className="general-photos-section">
            <div className="section-heading">
              <p className="eyebrow">Visão geral da área</p>
              <h2>Fotografias gerais</h2>
            </div>
            {photoError && <div className="notice notice-warning">{photoError}</div>}
            <PhotoUploader
              inspectionId={inspection.id}
              itemId={null}
              photos={generalPhotos}
              user={profile}
              editable={editable}
              onAdded={addPhoto}
              onRemoved={removePhoto}
            />
          </section>

          <div className="section-heading checklist-heading">
            <div>
              <p className="eyebrow">Checklist operacional</p>
              <h2>{items.length} itens para verificação</h2>
            </div>
            {editable && <span className="autosave-label">Salvamento automático ativo</span>}
          </div>
          <div className="checklist-list">
            {items.map((item) => (
              <ChecklistItemEditor
                key={item.id}
                inspectionId={inspection.id}
                item={item}
                photos={photos.filter((photo) => photo.itemId === item.id)}
                user={profile}
                editable={editable}
                onSaved={updateLocalItem}
                onPhotoAdded={addPhoto}
                onPhotoRemoved={removePhoto}
                onRegisterFlush={registerPendingFlush}
              />
            ))}
          </div>

          {pending.length > 0 && (
            <div className="notice notice-error pending-list" role="alert">
              <strong>Resolva estas pendências antes de finalizar:</strong>
              <ul>
                {pending.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}

          {editable && (
            <div className="finalize-panel">
              <div>
                <strong>Concluir inspeção</strong>
                <p>Após a conclusão, os dados serão bloqueados e o relatório será gerado.</p>
              </div>
              <button
                className="button button-primary compact-button"
                disabled={finalizing}
                onClick={() => void handleFinalize()}
              >
                {finalizing ? 'Validando…' : 'Finalizar inspeção'}
              </button>
            </div>
          )}

          {inspection.status === 'completed' && (
            <div className="report-panel">
              <div>
                <strong>Relatório PDF</strong>
                <p>
                  {inspection.reportStatus
                    ? reportLabels[inspection.reportStatus]
                    : 'Preparando relatório…'}
                </p>
                {inspection.reportError && (
                  <small className="field-error">{inspection.reportError}</small>
                )}
                {reportError && <small className="field-error">{reportError}</small>}
              </div>
              {reportUrl && (
                <a
                  className="button report-button"
                  href={reportUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir relatório
                </a>
              )}
            </div>
          )}

          <Link className="text-link" to="/history">
            Ver todas as inspeções
          </Link>
        </>
      )}
    </section>
  );
}
