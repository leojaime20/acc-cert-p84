import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ChecklistItemEditor } from '../components/inspection/ChecklistItemEditor';
import { PhotoUploader } from '../components/inspection/PhotoUploader';
import { useAuth } from '../features/auth/useAuth';
import {
  finalizeInspection,
  getInspection,
  listInspectionItems,
  updateInspectionCoResponsible,
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
  draft: 'Draft',
  completed: 'Completed',
  reopened: 'Reopened',
  cancelled: 'Cancelled',
};

const reportLabels = {
  pending: 'Report queued',
  processing: 'Generating report…',
  completed: 'Report ready',
  error: 'Report generation error',
};

export function InspectionPage() {
  const { inspectionId } = useParams();
  const navigate = useNavigate();
  const { profile } = useAuth();
  const pendingItemFlushes = useRef(new Map<string, () => Promise<void>>());
  const coResponsibleSaveTimer = useRef<number | undefined>(undefined);
  const coResponsibleSavePromise = useRef<Promise<void> | null>(null);
  const coResponsibleNameRef = useRef('');
  const savedCoResponsibleNameRef = useRef('');
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
  const [coResponsibleName, setCoResponsibleName] = useState('');
  const [savingCoResponsible, setSavingCoResponsible] = useState(false);

  const refreshInspection = useCallback(async () => {
    if (!inspectionId) return;
    const nextInspection = await getInspection(inspectionId);
    setInspection(nextInspection);
    setCoResponsibleName(nextInspection.coResponsibleName || '');
    coResponsibleNameRef.current = nextInspection.coResponsibleName || '';
    savedCoResponsibleNameRef.current = (nextInspection.coResponsibleName || '').trim();
    if (nextInspection.reportStoragePath) {
      try {
        setReportUrl(await getStorageDownloadUrl(nextInspection.reportStoragePath));
        setReportError('');
      } catch {
        setReportError('The report was generated, but cannot be opened right now.');
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
        setCoResponsibleName(nextInspection.coResponsibleName || '');
        coResponsibleNameRef.current = nextInspection.coResponsibleName || '';
        savedCoResponsibleNameRef.current = (nextInspection.coResponsibleName || '').trim();
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
              if (active)
                setReportError('The report was generated, but cannot be opened right now.');
            });
        }
      })
      .catch(() => {
        if (active) setError('Unable to load this inspection.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    void listInspectionItems(inspectionId)
      .then((nextItems) => {
        if (active) setItems(nextItems);
      })
      .catch(() => {
        if (active) setError('The inspection loaded, but its items are unavailable right now.');
      });

    void listInspectionPhotos(inspectionId)
      .then((nextPhotos) => {
        if (!active) return;
        setPhotos(nextPhotos);
        setPhotoError('');
      })
      .catch(() => {
        if (active)
          setPhotoError('Photos could not be loaded. The remaining data is still available.');
      });

    return () => {
      active = false;
      if (coResponsibleSaveTimer.current) window.clearTimeout(coResponsibleSaveTimer.current);
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

  async function saveCoResponsible() {
    if (!inspectionId) return;
    if (coResponsibleSavePromise.current) return coResponsibleSavePromise.current;
    const name = coResponsibleNameRef.current.trim();
    if (name === savedCoResponsibleNameRef.current) return;
    setSavingCoResponsible(true);
    const save = updateInspectionCoResponsible(inspectionId, name)
      .then(() => {
        savedCoResponsibleNameRef.current = name;
        setInspection((current) => (current ? { ...current, coResponsibleName: name } : current));
      })
      .catch(() => {
        setError('Unable to save the co-responsible person. Try again.');
      })
      .finally(() => {
        coResponsibleSavePromise.current = null;
        setSavingCoResponsible(false);
        if (coResponsibleNameRef.current.trim() !== savedCoResponsibleNameRef.current) {
          void saveCoResponsible();
        }
      });
    coResponsibleSavePromise.current = save;
    return save;
  }

  function updateCoResponsibleName(name: string) {
    setCoResponsibleName(name);
    coResponsibleNameRef.current = name;
    setInspection((current) => (current ? { ...current, coResponsibleName: name } : current));
    if (coResponsibleSaveTimer.current) window.clearTimeout(coResponsibleSaveTimer.current);
    coResponsibleSaveTimer.current = window.setTimeout(() => void saveCoResponsible(), 700);
  }

  async function flushCoResponsible() {
    if (coResponsibleSaveTimer.current) window.clearTimeout(coResponsibleSaveTimer.current);
    await saveCoResponsible();
    if (coResponsibleNameRef.current.trim() !== savedCoResponsibleNameRef.current) {
      await saveCoResponsible();
    }
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
      await flushCoResponsible();
      navigate(`/inspections/${inspectionId}/documents`);
    } catch {
      setError('Unable to save the latest changes before opening documents.');
      setOpeningDocuments(false);
    }
  }

  async function handleFinalize() {
    if (!inspectionId) return;
    setFinalizing(true);
    setPending([]);
    setError('');
    try {
      await flushCoResponsible();
      await finalizeInspection(inspectionId);
      await refreshInspection();
    } catch (finalizeError) {
      const details = (finalizeError as { details?: { pending?: string[] } }).details;
      setPending(details?.pending || ['Unable to complete. Review the inspection items.']);
    } finally {
      setFinalizing(false);
    }
  }

  return (
    <section className="inspection-page">
      <p className="eyebrow">Inspection</p>
      <div className="inspection-title-row">
        <h1>{inspection?.code || (loading ? 'Loading…' : inspectionId)}</h1>
        {inspection && (
          <button
            className="button inspection-documents-button"
            disabled={openingDocuments}
            onClick={() => void openDocuments()}
          >
            <span aria-hidden="true">PDF</span>
            <strong>{openingDocuments ? 'Saving…' : 'Documents'}</strong>
            {documentCount > 0 && <small>{documentCount}</small>}
          </button>
        )}
      </div>
      {error && <div className="notice notice-error">{error}</div>}
      {inspection && profile && (
        <>
          <div className="inspection-meta">
            <div>
              <span>Area</span>
              <strong>{inspection.areaCode}</strong>
              <small>{inspection.areaName}</small>
            </div>
            <div>
              <span>Responsible inspector</span>
              <strong>{inspection.inspectorName}</strong>
              <small>{inspection.inspectorEmail}</small>
            </div>
            <div>
              <span>Co-responsible person</span>
              {editable ? (
                <>
                  <input
                    value={coResponsibleName}
                    maxLength={120}
                    placeholder="Enter a name"
                    aria-label="Co-responsible person"
                    onChange={(event) => updateCoResponsibleName(event.target.value)}
                    onBlur={() => void flushCoResponsible()}
                  />
                  <small>{savingCoResponsible ? 'Saving…' : 'Optional'}</small>
                </>
              ) : (
                <strong>{inspection.coResponsibleName || 'Not assigned'}</strong>
              )}
            </div>
            <div>
              <span>Status</span>
              <strong className={`status-chip status-${inspection.status}`}>
                {statusLabels[inspection.status]}
              </strong>
              <small>{inspection.checklistTemplateCode}</small>
            </div>
          </div>

          <div className="summary-grid" aria-label="Inspection summary">
            <div>
              <strong>{inspection.summary.notStarted}</strong>
              <span>Pending</span>
            </div>
            <div>
              <strong>{inspection.summary.approved}</strong>
              <span>Approved</span>
            </div>
            <div>
              <strong>{inspection.summary.partiallyApproved}</strong>
              <span>Partial</span>
            </div>
            <div>
              <strong>{inspection.summary.rejected}</strong>
              <span>Rejected</span>
            </div>
            <div>
              <strong>{inspection.summary.notApplicable}</strong>
              <span>Not applicable</span>
            </div>
          </div>

          <section className="general-photos-section">
            <div className="section-heading">
              <p className="eyebrow">Area overview</p>
              <h2>General photos</h2>
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
              <p className="eyebrow">Operational checklist</p>
              <h2>{items.length} items to verify</h2>
            </div>
            {editable && <span className="autosave-label">Autosave enabled</span>}
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
              <strong>Resolve these pending items before completing:</strong>
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
                <strong>Complete inspection</strong>
                <p>After completion, the data will be locked and the report will be generated.</p>
              </div>
              <button
                className="button button-primary compact-button"
                disabled={finalizing}
                onClick={() => void handleFinalize()}
              >
                {finalizing ? 'Validating…' : 'Complete inspection'}
              </button>
            </div>
          )}

          {inspection.status === 'completed' && (
            <div className="report-panel">
              <div>
                <strong>PDF report</strong>
                <p>
                  {inspection.reportStatus
                    ? reportLabels[inspection.reportStatus]
                    : 'Preparing report…'}
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
                  Open report
                </a>
              )}
            </div>
          )}

          <Link className="text-link" to="/history">
            View all inspections
          </Link>
        </>
      )}
    </section>
  );
}
